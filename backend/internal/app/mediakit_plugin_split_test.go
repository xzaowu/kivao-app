package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestMediaKitPluginsUpgradeCombinedRegistryAndToggleIndependently(t *testing.T) {
	readPackage := func(id string) protocol.Manifest {
		t.Helper()
		data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", id+".yingce-plugin"))
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := protocol.ParsePluginPackage(data)
		if err != nil {
			t.Fatal(err)
		}
		if len(pkg.Manifest.Contributes.Providers) != 1 {
			t.Fatal("each plugin must own exactly one provider")
		}
		return pkg.Manifest
	}
	const enhanceID = "volcengine-mediakit"
	const depthID = "volcengine-mediakit-video-depth"
	enhance, depth := readPackage(enhanceID), readPackage(depthID)
	if enhance.Contributes.Providers[0].ID != VolcengineMediaKitEnhanceVideoProtocol || depth.Contributes.Providers[0].ID != VolcengineMediaKitVideoDepthProtocol {
		t.Fatal("existing protocol identity changed")
	}
	// Simulate the earlier combined package cached in an existing data directory.
	combined := enhance
	combined.Metadata.Version = "1.1.0"
	combined.Metadata.Enabled = true
	combined.Contributes.Providers = append(combined.Contributes.Providers, depth.Contributes.Providers...)
	raw, err := json.Marshal(combined)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := json.Marshal([]pluginRegistryRecord{{ID: enhanceID, Raw: raw, Source: PluginOriginUploaded}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), stored, 0o600); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: center}
	for _, flags := range [][2]bool{{true, true}, {false, true}, {true, false}, {false, false}} {
		for index, id := range []string{enhanceID, depthID} {
			if _, err := center.setEnabled(id, flags[index]); err != nil {
				t.Fatal(err)
			}
		}
		for index, id := range []string{VolcengineMediaKitEnhanceVideoProtocol, VolcengineMediaKitVideoDepthProtocol} {
			if svc.protocolIsSelectable(id) != flags[index] {
				t.Fatalf("protocol %s availability did not stay independent", id)
			}
		}
		for _, plugin := range center.list() {
			if plugin.Manifest.ID == enhanceID || plugin.Manifest.ID == depthID {
				if len(plugin.Manifest.Contributes.Providers) != 1 || plugin.Status == "invalid" {
					t.Fatal("combined provider or duplicate registration remains")
				}
			}
		}
	}
	reloaded, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	svc.pluginRuntime = reloaded
	if svc.protocolIsSelectable(VolcengineMediaKitEnhanceVideoProtocol) || svc.protocolIsSelectable(VolcengineMediaKitVideoDepthProtocol) {
		t.Fatal("disabled states were lost on restart")
	}
}
