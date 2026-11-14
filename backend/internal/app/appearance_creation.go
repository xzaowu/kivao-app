package app

import (
	"net/url"
	"path"
	"strings"
	"unicode"
)

type CreationShortcut struct {
	Group  string `json:"group"`
	Title  string `json:"title"`
	Icon   string `json:"icon"`
	Target string `json:"target"`
}

func defaultCreationShortcuts() []CreationShortcut {
	return []CreationShortcut{
		{Group: "作图", Title: "图片生成", Icon: "image", Target: "/toolbox/image"},
		{Group: "做视频", Title: "视频生成", Icon: "video", Target: "/toolbox/video"},
		{Group: "创作与工具", Title: "自由画布", Icon: "canvas", Target: "/canvas"},
		{Group: "创作与工具", Title: "技能", Icon: "skill", Target: "/skills"},
	}
}

func normalizeCreationShortcuts(items []CreationShortcut) ([]CreationShortcut, error) {
	if len(items) > 10 {
		return nil, BadAuthRequest("创作入口最多 10 个")
	}
	result := make([]CreationShortcut, 0, len(items))
	for _, item := range items {
		item.Group = strings.TrimSpace(item.Group)
		item.Title = strings.TrimSpace(item.Title)
		item.Icon = strings.TrimSpace(item.Icon)
		item.Target = strings.TrimSpace(item.Target)
		for _, char := range item.Group + item.Title {
			if unicode.IsControl(char) {
				return nil, BadAuthRequest("入口分组和标题不能包含控制字符")
			}
		}
		if err := validateAppearanceCopy(item.Group, "入口分组", 20, true); err != nil {
			return nil, err
		}
		if err := validateAppearanceCopy(item.Title, "入口标题", 20, true); err != nil {
			return nil, err
		}
		switch item.Icon {
		case "image", "video", "canvas", "skill", "text", "wand", "camera", "shopping":
		default:
			return nil, BadAuthRequest("请选择有效的入口图标")
		}
		u, err := url.Parse(item.Target)
		if err != nil || len(item.Target) > 512 || u.IsAbs() || u.Host != "" || strings.ContainsAny(item.Target, "\\\r\n\t") || strings.Contains(u.Path, "\\") || strings.HasPrefix(u.Path, "//") {
			return nil, BadAuthRequest("创作入口仅支持站内工作区页面链接")
		}
		for _, char := range u.Path {
			if unicode.IsControl(char) {
				return nil, BadAuthRequest("入口链接不能包含控制字符")
			}
		}
		u.Path = path.Clean(u.Path)
		if u.Path != "/" && u.Path != "/create" && u.Path != "/canvas" && !strings.HasPrefix(u.Path, "/canvas/") && u.Path != "/skills" && u.Path != "/toolbox/image" && u.Path != "/toolbox/video" && u.Path != "/ecommerce" && u.Path != "/projects" && !strings.HasPrefix(u.Path, "/projects/") && u.Path != "/assets" && u.Path != "/tasks" {
			return nil, BadAuthRequest("创作入口仅支持站内工作区页面链接")
		}
		item.Target = u.String()
		result = append(result, item)
	}
	return result, nil
}
