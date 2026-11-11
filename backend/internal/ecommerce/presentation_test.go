package ecommerce

import (
	"reflect"
	"strings"
	"testing"
)

func TestImagePresentationKeepsReviewedTextAndOverridesClippedLayout(t *testing.T) {
	draft := Draft{ProductName: "杯子", Platform: "未命名平台", Language: "中文", ImageType: "detail", Count: 2, References: []Reference{{ResourceID: "original", Role: "primary"}, {ResourceID: "style", Role: "style"}}}
	image := Image{ID: "image-1", Title: "仅用于方案列表的名称", Copy: "  随身收纳，\n每天轻装出门。  ", Prompt: "保留杯子外观，标题贴边出血，复制参考图的标签。"}
	before := image
	prompt := ImagePrompt(draft, image)
	if !reflect.DeepEqual(image, before) || !strings.Contains(prompt, "上图文案："+image.Copy+"\n") {
		t.Fatal("reviewed copy was changed")
	}
	if strings.Contains(prompt, image.Title) || !strings.HasSuffix(prompt, layoutSafetyRule) || strings.Index(prompt, "8%–92%") < strings.Index(prompt, image.Prompt) {
		t.Fatal("execution rule lost precedence or leaked the plan title")
	}
	for _, required := range []string{"商品原图", "风格参考，不作为商品身份或事实依据", "不裁字", "20%–30%", "光向、尺度与接触阴影一致", "不在单张重做时随机换脸"} {
		if !strings.Contains(prompt, required) {
			t.Fatal("presentation contract missing", required)
		}
	}
}

func TestBlankCopyDoesNotCreateMarketingTextOrRemoveProductPrint(t *testing.T) {
	for _, copy := range []string{"", " \n\t "} {
		prompt := ImagePrompt(Draft{}, Image{Title: "不应印在图中", Copy: copy, Prompt: "用户要求不出现人物，使用陈列假人展示衣服"})
		if !strings.Contains(prompt, "【无新增文案】") || !strings.Contains(prompt, "Logo 与包装印刷保留") || !strings.Contains(prompt, "用户不要人物时不添加") || !strings.Contains(prompt, "陈列假人时保持假人的材质") || strings.Contains(prompt, "【已审阅文案】") {
			t.Fatal("blank copy, product print or explicit subject boundary lost")
		}
	}
}
