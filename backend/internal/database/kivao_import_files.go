package database

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"yingce/backend/internal/protocol"
)

type kivaoImportFiles struct {
	digest  string
	ciphers int
}
type kivaoPluginRecord struct {
	ID            string          `json:"id"`
	Raw           json.RawMessage `json:"manifest"`
	PackagePath   string          `json:"packagePath"`
	PackageSHA256 string          `json:"packageSha256"`
	Source        string          `json:"source"`
	FileName      string          `json:"fileName,omitempty"`
	InstalledAt   time.Time       `json:"installedAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// 只验证已经准备好的两份离线文件副本，不复制文件、不生成密钥、不访问远程资源。
func inspectKivaoImportFiles(options KivaoImportOptions, data kivaoImportData) (kivaoImportFiles, error) {
	result := kivaoImportFiles{}
	src, err := filepath.Abs(options.SourceData)
	if err != nil || options.SourceData == "" {
		return result, errors.New("import_source_directory_required")
	}
	dst, err := filepath.Abs(options.TargetData)
	if err != nil || options.TargetData == "" {
		return result, errors.New("import_target_directory_required")
	}
	if src == dst || strings.HasPrefix(src, dst+string(os.PathSeparator)) || strings.HasPrefix(dst, src+string(os.PathSeparator)) {
		return result, errors.New("import_directories_overlap")
	}
	for _, dir := range []string{src, dst} {
		real, e := filepath.EvalSymlinks(dir)
		info, statErr := os.Stat(dir)
		if e != nil || real != dir || statErr != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
			return result, errors.New("import_directory_not_private_or_symlink")
		}
	}
	source, err := os.OpenRoot(src)
	if err != nil {
		return result, errors.New("import_source_directory_unreadable")
	}
	defer source.Close()
	target, err := os.OpenRoot(dst)
	if err != nil {
		return result, errors.New("import_target_directory_unreadable")
	}
	defer target.Close()
	for _, root := range []*os.Root{source, target} {
		for _, path := range []string{".settings-key", "plugin_registry.json", "plugin-packages"} {
			info, e := root.Lstat(path)
			if e != nil || info.Mode()&os.ModeSymlink != 0 {
				return result, errors.New("import_file_symlink_or_missing")
			}
		}
	}
	for _, path := range []string{".settings-key", "plugin_registry.json"} {
		a, _ := source.Stat(path)
		b, _ := target.Stat(path)
		if os.SameFile(a, b) {
			return result, errors.New("import_shared_file_not_allowed")
		}
	}
	key, err := kivaoPrivateRead(source, ".settings-key", 32)
	if err != nil || len(key) != 32 {
		return result, errors.New("import_source_key_invalid")
	}
	targetKey, err := kivaoPrivateRead(target, ".settings-key", 32)
	if err != nil || !bytes.Equal(key, targetKey) {
		return result, errors.New("import_settings_key_mismatch")
	}
	defer clear(key)
	defer clear(targetKey)
	entries, err := os.ReadDir(dst)
	if err != nil {
		return result, errors.New("import_target_directory_unreadable")
	}
	for _, entry := range entries {
		if !kivaoContains([]string{".settings-key", "plugin_registry.json", "plugin-packages"}, entry.Name()) {
			return result, errors.New("import_target_contains_omitted_files")
		}
	}
	pluginDigest, err := kivaoVerifyPlugins(source, target, options.PluginIDs)
	if err != nil {
		return result, err
	}
	catalogDigest, err := kivaoVerifyProtocolBindings(target, options, data)
	if err != nil {
		return result, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return result, errors.New("import_key_invalid")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return result, errors.New("import_cipher_unavailable")
	}
	// 包含密文字段和 JSON 内嵌密文。只做认证解密后立即丢弃，不写明文或摘要。
	var verify func(any) error
	verify = func(value any) error {
		switch v := value.(type) {
		case string:
			if strings.HasPrefix(v, "enc:v1:") {
				payload, e := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(v, "enc:v1:"))
				if e != nil || len(payload) < gcm.NonceSize() {
					return errors.New("import_ciphertext_invalid")
				}
				plain, e := gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], nil)
				clear(plain)
				if e != nil {
					return errors.New("import_ciphertext_authentication_failed")
				}
				result.ciphers++
				return nil
			}
			if strings.HasPrefix(v, "{") || strings.HasPrefix(v, "[") {
				var parsed any
				if json.Unmarshal([]byte(v), &parsed) == nil {
					return verify(parsed)
				}
			}
		case map[string]any:
			for _, v := range v {
				if e := verify(v); e != nil {
					return e
				}
			}
		case []any:
			for _, v := range v {
				if e := verify(v); e != nil {
					return e
				}
			}
		}
		return nil
	}
	for _, rows := range data {
		for _, row := range rows {
			if err := verify(row); err != nil {
				return result, err
			}
		}
	}
	keySum := sha256.Sum256(key)
	result.digest = kivaoDigest([]any{kivaoImportScope, pluginDigest, catalogDigest, hex.EncodeToString(keySum[:])})
	return result, nil
}

func kivaoPrivateRead(root *os.Root, name string, limit int64) ([]byte, error) {
	info, err := root.Lstat(name)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > limit {
		return nil, errors.New("import_private_file_invalid")
	}
	f, err := root.Open(name)
	if err != nil {
		return nil, errors.New("import_private_file_unreadable")
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errors.New("import_private_file_limit")
	}
	return b, nil
}

func kivaoVerifyPlugins(source, target *os.Root, ids []string) (string, error) {
	if len(ids) != 2 || ids[0] == "" || ids[1] == "" || ids[0] == ids[1] {
		return "", errors.New("import_two_explicit_plugin_ids_required")
	}
	var src, dst []kivaoPluginRecord
	for i, root := range []*os.Root{source, target} {
		b, err := kivaoPrivateRead(root, "plugin_registry.json", 16<<20)
		if err != nil {
			return "", errors.New("import_plugin_registry_unreadable")
		}
		records := &src
		if i == 1 {
			records = &dst
		}
		if json.Unmarshal(b, records) != nil {
			return "", errors.New("import_plugin_registry_invalid")
		}
	}
	if len(dst) != 2 {
		return "", errors.New("import_target_plugin_scope_invalid")
	}
	dir, err := target.Open("plugin-packages")
	if err != nil {
		return "", errors.New("import_target_package_scope_invalid")
	}
	entries, err := dir.ReadDir(-1)
	dir.Close()
	if err != nil || len(entries) != 2 {
		return "", errors.New("import_target_package_scope_invalid")
	}
	hashes := map[string]string{}
	for _, id := range ids {
		var a, b *kivaoPluginRecord
		for i := range src {
			if src[i].ID == id {
				if a != nil {
					return "", errors.New("import_duplicate_plugin_id")
				}
				a = &src[i]
			}
		}
		for i := range dst {
			if dst[i].ID == id {
				if b != nil {
					return "", errors.New("import_duplicate_plugin_id")
				}
				b = &dst[i]
			}
		}
		if a == nil || b == nil || a.PackagePath == "" || a.PackagePath != filepath.Base(a.PackagePath) || a.PackageSHA256 == "" {
			return "", errors.New("import_plugin_identity_missing")
		}
		// 旧 KIVAO 随镜像打包的插件被标为 official，新版不再随镜像提供它们。
		// 只允许已明确选中的相同包在目标副本重新登记为 uploaded，避免启动时被清除。
		if b.Source != "uploaded" || !kivaoContains([]string{"uploaded", "official", "bundled", "system"}, a.Source) {
			return "", errors.New("import_plugin_requires_independent_registration")
		}
		if a.PackagePath != b.PackagePath || a.PackageSHA256 != b.PackageSHA256 || a.FileName != b.FileName || !a.InstalledAt.Equal(b.InstalledAt) || !a.UpdatedAt.Equal(b.UpdatedAt) || !kivaoManifestEqual(a.Raw, b.Raw) {
			return "", errors.New("import_plugin_identity_mismatch")
		}
		si, se := source.Stat("plugin-packages/" + a.PackagePath)
		ti, te := target.Stat("plugin-packages/" + b.PackagePath)
		if se != nil || te != nil || os.SameFile(si, ti) {
			return "", errors.New("import_shared_plugin_file_not_allowed")
		}
		for _, root := range []*os.Root{source, target} {
			raw, err := kivaoPrivateRead(root, "plugin-packages/"+a.PackagePath, protocol.PluginPackageMaxBytes)
			if err != nil {
				return "", errors.New("import_plugin_package_unreadable")
			}
			sum := sha256.Sum256(raw)
			if hex.EncodeToString(sum[:]) != a.PackageSHA256 {
				return "", errors.New("import_plugin_package_hash_mismatch")
			}
			pkg, err := protocol.ParsePluginPackage(raw)
			if err != nil || pkg.Manifest.Metadata.ID != id || pkg.Manifest.Metadata.Version == "" {
				return "", errors.New("import_plugin_package_invalid")
			}
			if !kivaoInstalledManifestMatchesPackage(pkg.ManifestRaw, a.Raw) {
				return "", errors.New("import_plugin_manifest_mismatch")
			}
		}
		hashes[id] = kivaoDigest([]any{a, b})
	}
	return kivaoDigest(hashes), nil
}

// 插件注册表由运行时序列化：显式零值、默认 enabled 与省略的 required:false
// 可以不同；按同一原生 Manifest 合同比较。启用状态仍须由源、目标注册表精确匹配。
func kivaoInstalledManifestMatchesPackage(archive, installed []byte) bool {
	var left, right protocol.Manifest
	if json.Unmarshal(archive, &left) != nil || json.Unmarshal(installed, &right) != nil {
		return false
	}
	left.Metadata.Enabled = right.Metadata.Enabled
	a, e1 := json.Marshal(left)
	b, e2 := json.Marshal(right)
	return e1 == nil && e2 == nil && bytes.Equal(a, b)
}

func kivaoManifestEqual(a, b []byte) bool {
	var left, right any
	decode := func(raw []byte, out *any) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		return decoder.Decode(out)
	}
	return json.Valid(a) && json.Valid(b) && decode(a, &left) == nil && decode(b, &right) == nil && kivaoDigest(left) == kivaoDigest(right)
}

func kivaoVerifyProtocolBindings(target *os.Root, options KivaoImportOptions, data kivaoImportData) (string, error) {
	for _, id := range options.PluginIDs {
		if _, exists := protocol.Builtins().Get(id); exists {
			return "", errors.New("import_custom_plugin_collides_with_builtin")
		}
	}
	if options.OfficialPluginsDir == "" {
		return "", errors.New("import_official_package_directory_required")
	}
	entries, err := os.ReadDir(options.OfficialPluginsDir)
	if err != nil {
		return "", errors.New("import_official_package_directory_unreadable")
	}
	known := map[string]bool{}
	hashes := map[string]string{}
	register := func(raw []byte) error {
		adapters, e := protocol.LoadInstalledProviders(raw, nil)
		if e != nil {
			return errors.New("import_provider_manifest_not_loadable")
		}
		for _, a := range adapters {
			m := a.Metadata()
			known[m.ID] = true
			for _, alias := range m.LegacyAliases {
				known[alias] = true
			}
		}
		return nil
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yingce-plugin") {
			continue
		}
		info, e := entry.Info()
		if e != nil || !info.Mode().IsRegular() || info.Size() > protocol.PluginPackageMaxBytes {
			return "", errors.New("import_official_package_invalid")
		}
		raw, e := os.ReadFile(filepath.Join(options.OfficialPluginsDir, entry.Name()))
		if e != nil {
			return "", errors.New("import_official_package_unreadable")
		}
		pkg, e := protocol.ParsePluginPackage(raw)
		if e != nil {
			return "", errors.New("import_official_package_invalid")
		}
		if kivaoContains(options.PluginIDs, pkg.Manifest.Metadata.ID) {
			return "", errors.New("import_custom_plugin_would_be_replaced_by_official_package")
		}
		if len(pkg.Manifest.Contributes.Providers) > 0 {
			if e := register(pkg.ManifestRaw); e != nil {
				return "", e
			}
		}
		sum := sha256.Sum256(raw)
		hashes[pkg.Manifest.Metadata.ID] = hex.EncodeToString(sum[:])
	}
	registry, e := kivaoPrivateRead(target, "plugin_registry.json", 16<<20)
	if e != nil {
		return "", e
	}
	var records []kivaoPluginRecord
	if json.Unmarshal(registry, &records) != nil {
		return "", errors.New("import_plugin_registry_invalid")
	}
	for _, record := range records {
		var manifest protocol.Manifest
		if json.Unmarshal(record.Raw, &manifest) != nil {
			return "", errors.New("import_plugin_manifest_invalid")
		}
		if len(manifest.Contributes.Providers) > 0 {
			if err := register(record.Raw); err != nil {
				return "", err
			}
		}
	}
	for _, row := range data["channel_models"] {
		id := kivaoString(row["protocol"])
		// 保留未配置的禁用占位记录；绝不为其猜测或自动启用协议。
		if id == "" && kivaoString(row["capability"]) == "" && row["enabled"] == false {
			continue
		}
		if known[id] {
			continue
		}
		return "", errors.New("import_channel_protocol_dependency_missing")
	}
	return kivaoDigest(hashes), nil
}
