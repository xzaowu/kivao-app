package app

import (
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationShortcutsValidateLimitsAndNavigation(t *testing.T) {
	valid := CreationShortcut{Group: " 作图 ", Title: " 商品主图 ", Icon: "image", Target: "/toolbox/image?tool=product"}
	got, err := normalizeCreationShortcuts([]CreationShortcut{valid})
	if err != nil || len(got) != 1 || got[0].Title != "商品主图" || got[0].Group != "作图" {
		t.Fatalf("normalize: %v", err)
	}
	for _, target := range []string{"/create", "/ecommerce", "/projects", "/projects/test/e/episode", "/assets", "/tasks"} {
		item := valid
		item.Target = target
		if _, err := normalizeCreationShortcuts([]CreationShortcut{item}); err != nil {
			t.Errorf("valid workspace target rejected: %s", target)
		}
	}
	for _, target := range []string{"https://example.com", "//example.com", "javascript:alert(1)", "/\\example.com", "/%2fexample.com", "/canvas/../admin", "/canvas/%0a", "/admin", ""} {
		item := valid
		item.Target = target
		if _, err := normalizeCreationShortcuts([]CreationShortcut{item}); err == nil {
			t.Errorf("accepted unsafe target %q", target)
		}
	}
	for _, item := range []CreationShortcut{
		{Group: "", Title: "标题", Icon: "image", Target: "/"},
		{Group: "分组", Title: strings.Repeat("字", 21), Icon: "image", Target: "/"},
		{Group: "分\n组", Title: "标题", Icon: "image", Target: "/"},
		{Group: "分组", Title: "标题", Icon: "unknown", Target: "/"},
	} {
		if _, err := normalizeCreationShortcuts([]CreationShortcut{item}); err == nil {
			t.Fatal("accepted invalid shortcut")
		}
	}
	items := make([]CreationShortcut, 11)
	if _, err := normalizeCreationShortcuts(items); err == nil {
		t.Fatal("accepted 11 shortcuts")
	}
	for i := range items {
		items[i] = valid
	}
	if got, err := normalizeCreationShortcuts(items[:10]); err != nil || len(got) != 10 {
		t.Fatal("10 shortcuts rejected")
	}
}

func TestCreationShortcutsPersistClearAndRequireAdmin(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	public, err := svc.Appearance()
	if err != nil || len(public.CreationShortcuts) != 4 {
		t.Fatal("missing defaults")
	}
	value := defaultAppearanceSetting()
	value.CreationShortcuts = []CreationShortcut{{Group: "视频", Title: "广告", Icon: "video", Target: "/toolbox/video?tool=ad"}, {Group: "画布", Title: "画布", Icon: "canvas", Target: "/canvas"}}
	if _, err := svc.UpdateAppearance(&model.User{ID: "user", Role: model.UserRoleUser}, value); err == nil {
		t.Fatal("ordinary user wrote appearance")
	}
	if _, err := svc.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	public, err = svc.Appearance()
	if err != nil || !reflect.DeepEqual(public.CreationShortcuts, value.CreationShortcuts) {
		t.Fatal("shortcut persistence/order mismatch")
	}
	value.CreationShortcuts = nil
	updated, err := svc.UpdateAppearance(admin, value)
	if err != nil || len(updated.CreationShortcuts) != 2 {
		t.Fatal("omitted shortcuts erased existing settings")
	}
	value.CreationShortcuts = []CreationShortcut{}
	if _, err := svc.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	public, err = svc.Appearance()
	if err != nil || public.CreationShortcuts == nil || len(public.CreationShortcuts) != 0 {
		t.Fatal("cleared shortcuts resurrected defaults")
	}
}
