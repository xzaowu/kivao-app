package app

import (
	"archive/zip"
	"bytes"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

type commerceStudioSparseZipWriter struct{ file *os.File }

func (w commerceStudioSparseZipWriter) Write(p []byte) (int, error) {
	if len(p) > 0 && bytes.Count(p, []byte{0}) == len(p) {
		_, err := w.file.Seek(int64(len(p)), io.SeekCurrent)
		return len(p), err
	}
	return w.file.Write(p)
}

type commerceStudioZeroReader struct{}

func (commerceStudioZeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestCommerceStudioSkillAcceptsActualPackageAbove500MB(t *testing.T) {
	svc := &Service{dataDir: t.TempDir()}
	file, err := os.Create(filepath.Join(t.TempDir(), "large.zip"))
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(commerceStudioSparseZipWriter{file})
	manifest, err := writer.Create("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = manifest.Write([]byte("---\nname: 大包技能\ndescription: 电商摄影\n---\n按产品证据策划。"))
	attachment, err := writer.CreateHeader(&zip.FileHeader{Name: "assets/large.bin", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.CopyN(attachment, commerceStudioZeroReader{}, 501<<20); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	stat, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if stat.Size() <= 500<<20 {
		t.Fatal("fixture is not above 500MB")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	item, err := svc.installCommerceStudioReader(file, "large.zip", "")
	_ = file.Close()
	if err != nil {
		t.Fatal(err)
	}
	if item.Name != "大包技能" {
		t.Fatal(item.Name)
	}
}

func commerceStudioTestUpload(t *testing.T, name, body string) *multipart.FileHeader {
	t.Helper()
	var data bytes.Buffer
	w := multipart.NewWriter(&data)
	f, err := w.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write([]byte(body))
	_ = w.Close()
	req := httptest.NewRequest("POST", "/", &data)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if err := req.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = req.MultipartForm.RemoveAll() })
	return req.MultipartForm.File["file"][0]
}

func TestCommerceStudioInstalledSkillPermissionsRoutingRenameAndSwitch(t *testing.T) {
	svc, _ := knowledgeTestService(t)
	svc.dataDir = t.TempDir()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	upload := commerceStudioTestUpload(t, "coffee.md", "---\nname: 咖啡策划\ndescription: 咖啡产品场景与咖啡详情设计\n---\n依据咖啡产品证据安排细节，不虚构卖点。")
	if err := svc.InstallCommerceStudioSkillUpload(user, upload); err == nil {
		t.Fatal("non-admin installed")
	}
	if err := svc.InstallCommerceStudioSkillUpload(admin, upload); err != nil {
		t.Fatal(err)
	}
	installed, err := svc.commerceStudioInstalledSkills()
	if err != nil || len(installed) != 1 {
		t.Fatal(installed, err)
	}
	id := installed[0].ID
	list, err := svc.CommerceStudioManagedSkills(admin)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range list {
		if item.ID == id {
			found = item.Enabled
		}
	}
	if !found {
		t.Fatal("not enabled by default")
	}
	draft := CommerceStudioDraft{ProductName: "咖啡", Category: "咖啡", ImageType: "detail", Platform: "taobao"}
	block, calls, err := svc.commerceStudioManagedSkillBlock(draft, nil)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, call := range calls {
		found = found || call.ID == id
	}
	if !found || !strings.Contains(block, "不虚构卖点") {
		t.Fatal("installed method not selected", calls)
	}
	if err := svc.RenameCommerceStudioSkill(user, id, "新名称"); err == nil {
		t.Fatal("non-admin renamed")
	}
	if err := svc.RenameCommerceStudioSkill(admin, id, "我的咖啡摄影"); err != nil {
		t.Fatal(err)
	}
	// Simulate an upstream replacement through the same optimistic update path.
	if err := svc.updateCommerceStudioInstalledSkill(id, func(item *commerceStudioInstalledSkill) {
		item.Name = "upstream name"
		item.Instructions = "更新后的咖啡方法"
		item.Version = "v2"
	}); err != nil {
		t.Fatal(err)
	}
	installed, _ = svc.commerceStudioInstalledSkills()
	if installed[0].Name != "我的咖啡摄影" || installed[0].Version != "v2" {
		t.Fatal("update lost custom name", installed)
	}
	if err := svc.SetCommerceStudioManagedSkillEnabled(admin, id, false); err != nil {
		t.Fatal(err)
	}
	if err := svc.InstallCommerceStudioSkillUpload(admin, upload); err != nil {
		t.Fatal(err)
	}
	installed, err = svc.commerceStudioInstalledSkills()
	if err != nil || len(installed) != 1 || installed[0].ID != id || installed[0].Name != "我的咖啡摄影" {
		t.Fatal("reinstall lost identity or alias", installed, err)
	}
	_, calls, err = svc.commerceStudioManagedSkillBlock(draft, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range calls {
		if call.ID == id {
			t.Fatal("disabled method selected")
		}
	}
	big := *upload
	big.Size = CommerceStudioSkillMaxBytes + 1
	if err := svc.InstallCommerceStudioSkillUpload(admin, &big); err == nil || !strings.Contains(err.Error(), "文件太大") {
		t.Fatal("missing size error", err)
	}
}

func TestCommerceStudioSkillArchiveReferencesAndPathLimits(t *testing.T) {
	makeZip := func(entries map[string]string) string {
		t.Helper()
		filename := filepath.Join(t.TempDir(), "skill.zip")
		file, err := os.Create(filename)
		if err != nil {
			t.Fatal(err)
		}
		writer := zip.NewWriter(file)
		for name, body := range entries {
			f, err := writer.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			_, _ = f.Write([]byte(body))
		}
		_ = writer.Close()
		_ = file.Close()
		return filename
	}
	filename := makeZip(map[string]string{"repo/SKILL.md": "# 摄影\n[方法](references/method.md)", "repo/references/method.md": "引用摄影规则", "repo/assets/photo.bin": "binary"})
	body, _, err := readCommerceStudioSkillPackage(filename, "")
	if err != nil || !strings.Contains(string(body), "引用摄影规则") {
		t.Fatal(string(body), err)
	}
	for _, entries := range []map[string]string{
		{"SKILL.md": "safe", "../escape": "bad"},
		{"SKILL.md": "[missing](missing.md)"},
		{"one/SKILL.md": "one", "two/SKILL.md": "two"},
		{"SKILL.md": strings.Repeat("a", 32001)},
	} {
		if _, _, err := readCommerceStudioSkillPackage(makeZip(entries), ""); err == nil {
			t.Fatal("invalid package accepted", entries)
		}
	}
	if CommerceStudioSkillMaxBytes <= 500<<20 {
		t.Fatal("ecommerce upload still limited to 500MB")
	}
}
