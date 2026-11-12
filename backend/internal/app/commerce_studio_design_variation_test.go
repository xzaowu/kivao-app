package app

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceagent"
)

func TestCommerceStudioDesignVariationAvoidsTheLastRunOfADirection(t *testing.T) {
	draft := CommerceStudioDraft{ImageType: "detail", Count: 9, Platform: "taobao", CreativeRecommendationID: "rec-" + t.Name(), CreativeDirectionID: "direction-1"}
	first := commerceStudioDesignVariationFor("user", "project", draft, "maternal", "安静治愈", "安静治愈")
	second := commerceStudioDesignVariationFor("user", "project", draft, "maternal", "安静治愈", "安静治愈")
	if len(first.Layouts) != 9 || len(second.Layouts) != 9 {
		t.Fatalf("detail variations need nine layouts: %d %d", len(first.Layouts), len(second.Layouts))
	}
	if first.Signature == second.Signature || first.UIKit == second.UIKit || first.Persona == second.Persona || slices.Equal(first.Layouts, second.Layouts) {
		t.Fatalf("the same direction drew the same design twice:\n%+v\n%+v", first, second)
	}
	other := draft
	other.CreativeDirectionID = "direction-2"
	if recent := commerceStudioDesignHistory.recent(commerceStudioDesignMemoryKey("user", "project", other)); len(recent) != 0 {
		t.Fatalf("another direction inherited the history: %v", recent)
	}
	draft.ModelEnabled, draft.References = true, []CommerceStudioReference{{ResourceID: "model", Role: "model"}}
	if withModel := commerceStudioDesignVariationFor("user", "project", draft, "maternal", "", ""); !strings.HasPrefix(withModel.Persona, "用户已上传模特参考图") {
		t.Fatalf("user model reference did not lead the persona: %s", withModel.Persona)
	}
	draft.Instruction = "整套不要人物，只拍商品"
	if quiet := commerceStudioDesignVariationFor("user", "project", draft, "maternal", "", ""); quiet.Persona != "" {
		t.Fatalf("no-people request still cast a persona: %s", quiet.Persona)
	}
}

func TestCommerceStudioDesignMemoryKeepsRecentRunsOnly(t *testing.T) {
	memory := &commerceStudioDesignMemory{runs: map[string][][]string{}}
	for run := 0; run < 5; run++ {
		memory.remember("key", []string{fmt.Sprintf("signature-%d", run)})
	}
	if recent := memory.recent("key"); !slices.Equal(recent, []string{"signature-2", "signature-3", "signature-4"}) {
		t.Fatalf("recent runs = %v", recent)
	}
	for key := 0; key <= commerceStudioDesignMemoryKeys; key++ {
		memory.remember(fmt.Sprintf("key-%d", key), []string{"signature"})
	}
	if len(memory.runs) != commerceStudioDesignMemoryKeys || len(memory.order) != commerceStudioDesignMemoryKeys || memory.recent("key") != nil {
		t.Fatalf("memory grew past its bound: %d keys", len(memory.runs))
	}
}

func TestCommerceStudioPeopleAllowedFollowsTypeAndRequest(t *testing.T) {
	for _, tc := range []struct {
		draft CommerceStudioDraft
		want  bool
	}{
		{CommerceStudioDraft{ImageType: "detail"}, true},
		{CommerceStudioDraft{ImageType: "white"}, false},
		{CommerceStudioDraft{ImageType: "sku"}, false},
		{CommerceStudioDraft{ImageType: "package"}, false},
		{CommerceStudioDraft{ImageType: "detail", Instruction: "整套不要人物，只拍商品"}, false},
		{CommerceStudioDraft{ImageType: "main", Instruction: "No people, product only"}, false},
		{CommerceStudioDraft{ImageType: "set", StylePrompt: "无模特的极简棚拍"}, false},
		{CommerceStudioDraft{ImageType: "scene", TypeOptions: map[string]string{"people": "不出现人物"}}, false},
		{CommerceStudioDraft{ImageType: "detail", Instruction: "适合送给别人。"}, true},
		{CommerceStudioDraft{ImageType: "detail", Instruction: "不要人工合成感"}, true},
	} {
		if got := commerceStudioPeopleAllowed(tc.draft); got != tc.want {
			t.Errorf("%+v: people allowed = %v, want %v", tc.draft, got, tc.want)
		}
	}
}

func TestCommerceStudioDirectionsContentTypeAndPlatformAliases(t *testing.T) {
	pair := CommerceStudioDraft{ImageType: "set", Count: 2, Platform: "taobao", TypeOptions: map[string]string{"distribution": "主图 1 张、副图 1 张"}}
	if got := commerceStudioDirectionsContentType(pair); got != "main-secondary" {
		t.Fatalf("主副图 content type = %s", got)
	}
	if request := commerceStudioFastDirectionsRequest(pair); !strings.Contains(request, "内容类型：主副图组合") {
		t.Fatalf("主副图 directions request = %s", request)
	}
	pair.Count = 8
	if got := commerceStudioDirectionsContentType(pair); got != "set" {
		t.Fatalf("product set content type = %s", got)
	}
	for _, alias := range []string{"pdd", "pinduoduo", "拼多多"} {
		if p := commerceStudioWorkbenchPlatform(CommerceStudioDraft{Platform: alias}); p.Label != "拼多多" || p.ForbidTextOnMain || !strings.Contains(strings.Join(p.Rules, "\n"), "待核实") {
			t.Fatalf("%s lost the scoped, unverified 拼多多 profile: %+v", alias, p)
		}
	}
	if p := commerceStudioWorkbenchPlatform(CommerceStudioDraft{Platform: "tmall"}); p.Label != "天猫" {
		t.Fatalf("tmall lost its independent platform profile: %+v", p)
	}
}

func TestCommerceStudioPlanningBatchPromptSharesTheDrawnOutline(t *testing.T) {
	variation := ecommerceagent.PickDesignVariation(nil, ecommerceagent.VariationInput{ImageType: "detail", Platform: "taobao", Category: "tech", Count: 9, PeopleAllowed: true})
	raw, _ := json.Marshal(map[string]any{"ecommerceDesignVariation": variation})
	var metadata map[string]any
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	outline := commerceStudioDetailOutline(metadata, 9)
	if !slices.Equal(outline, variation.Layouts) {
		t.Fatalf("batches did not use the drawn outline: %q", outline)
	}
	if fallback := commerceStudioDetailOutline(metadata, 12); !slices.Equal(fallback, commerceStudioPlanningOutline(12)) {
		t.Fatal("an outline for another page count was used")
	}
	if fallback := commerceStudioDetailOutline(map[string]any{}, 9); !slices.Equal(fallback, commerceStudioPlanningOutline(9)) {
		t.Fatal("a task without a variation lost the fixed outline")
	}
	prompt := commerceStudioPlanningBatchPrompt("base prompt", outline, [2]int{4, 6})
	for i, page := range outline {
		if !strings.Contains(prompt, fmt.Sprintf("%d. %s", i+1, page)) {
			t.Fatalf("batch prompt lacks page %d", i+1)
		}
	}
	if !strings.HasPrefix(prompt, "base prompt") || !strings.Contains(prompt, "整套共 9 张") || !strings.Contains(prompt, "本次只输出第 4–6 张") || strings.Count(prompt, "（本次撰写）") != 3 {
		t.Fatalf("batch prompt = %s", prompt)
	}
}

func TestCommerceStudioPlanningAppendsADifferentDesignVariationEachRun(t *testing.T) {
	svc, db, _, _ := commerceStudioCreationTestService(t)
	t.Setenv("AI_MODE", "mock")
	project, err := svc.CreateCommerceStudioProject("user")
	if err != nil {
		t.Fatal(err)
	}
	draft := CommerceStudioDraft{ProductName: "蓝牙耳机", Category: "数码", Instruction: "生成详情页", ImageType: "detail", Count: 9, Platform: "taobao", Ratio: "3:4"}
	raw, _ := json.Marshal(draft)
	if err := db.Model(project).Update("draft_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	response, err := svc.RecommendCommerceStudioCreativeDirectionsContext(t.Context(), "user", CommerceStudioCreativeDirectionsRequest{ProjectID: project.ID, ProductName: "蓝牙耳机", Category: "数码", Platform: "taobao", Count: 9, ImageType: "detail"})
	if err != nil {
		t.Fatal(err)
	}
	selection, err := svc.SelectCommerceStudioCreativeDirection("user", response.RecommendationID, response.Directions[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	draft.CreativeRecommendationID, draft.CreativeDirectionID = response.RecommendationID, selection.DirectionID
	raw, _ = json.Marshal(draft)
	if err := db.Model(project).Update("draft_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	signatures := map[string]bool{}
	for run := 0; run < 2; run++ {
		input := map[string]any{"mode": "text", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": project.ID}}
		prompt, err := svc.prepareCommerceStudioWorkbenchTask("user", input, "最终返回工作台JSON")
		if err != nil {
			t.Fatal(err)
		}
		variation, ok := input["metadata"].(map[string]any)["ecommerceDesignVariation"].(ecommerceagent.DesignVariation)
		if !ok || len(variation.Layouts) != 9 {
			t.Fatalf("planning task lacks a nine-page variation: %+v", input["metadata"])
		}
		block := variation.PromptBlock("detail")
		if !strings.Contains(prompt, block) || strings.LastIndex(prompt, "【按商品选择叙事") < strings.Index(prompt, block) {
			t.Fatal("product-specific planning must constrain the sampled layout kit")
		}
		if !strings.Contains(prompt, "不规定九屏人物数量") || !strings.Contains(prompt, "不强制参数表") || !strings.Contains(prompt, "已选 visualSystem 的字体家族") {
			t.Fatal("planning lost product-specific casting, closing layout or confirmed typography")
		}
		signatures[variation.Signature] = true
	}
	if len(signatures) != 2 {
		t.Fatal("planning the same direction twice drew the same design")
	}
}

// A new project of the same product and style starts from that product's
// recent runs: six consecutive sets never repeat one exact layout list, and
// the UI kit and persona change from one set to the next.
func TestCommerceStudioDesignVariationAvoidsRepeatsAcrossProjectsOfOneProduct(t *testing.T) {
	product := CommerceStudioReference{ResourceID: "bottle-" + t.Name(), Role: "primary"}
	var previous ecommerceagent.DesignVariation
	seen := map[string]int{}
	for run := 0; run < 6; run++ {
		// Every run is a new project with its own recommendation, so only the
		// product memory links them.
		draft := CommerceStudioDraft{ProductName: "婴儿奶瓶", ImageType: "set", Count: 7, Platform: "taobao", References: []CommerceStudioReference{product},
			CreativeRecommendationID: fmt.Sprintf("rec-%s-%d", t.Name(), run), CreativeDirectionID: "direction-1"}
		v := commerceStudioDesignVariationFor("user", fmt.Sprintf("project-%s-%d", t.Name(), run), draft, "maternal", "安静治愈 晨光窗边的亚麻与原木托盘", "安静治愈")
		if len(v.Layouts) != 7 || v.UIKit == "" || v.Persona == "" {
			t.Fatalf("run %d drew an incomplete set: %+v", run+1, v)
		}
		layouts := strings.Join(v.Layouts, "\n")
		if first, ok := seen[layouts]; ok {
			t.Fatalf("run %d repeated the layout list of run %d:\n%s", run+1, first+1, layouts)
		}
		seen[layouts] = run
		if run > 0 && (v.UIKit == previous.UIKit || v.Persona == previous.Persona) {
			t.Fatalf("run %d kept the UI kit or persona of run %d:\n%s | %s\n%s | %s", run+1, run, previous.UIKit, previous.Persona, v.UIKit, v.Persona)
		}
		previous = v
	}
}

func TestCommerceStudioDesignProductMemoryKeyNamesProductTypeAndStyle(t *testing.T) {
	draft := CommerceStudioDraft{ProductName: " 婴儿 奶瓶 ", ImageType: "set", Count: 2, TypeOptions: map[string]string{"distribution": "主图 1 张、副图 1 张"}}
	if key := commerceStudioDesignProductMemoryKey("user", draft, "安静治愈·晨光母婴"); key != "user|product|name:婴儿奶瓶|main-secondary|preset:quiet-healing" {
		t.Fatalf("product-name key = %s", key)
	}
	draft.References = []CommerceStudioReference{{ResourceID: "style-ref", Role: "style"}, {ResourceID: "bottle", Role: "primary"}}
	if key := commerceStudioDesignProductMemoryKey("user", draft, "安静治愈"); key != "user|product|ref:bottle|main-secondary|preset:quiet-healing" {
		t.Fatalf("product-reference key = %s", key)
	}
	if key := commerceStudioDesignProductMemoryKey("user", draft, "我的 风格！"); !strings.HasSuffix(key, "|我的风格") {
		t.Fatalf("custom style key = %s", key)
	}
	if key := commerceStudioDesignProductMemoryKey("user", CommerceStudioDraft{ImageType: "detail"}, "安静治愈"); key != "" {
		t.Fatalf("an unknown product got a key: %s", key)
	}
	strategy := map[string]any{"direction": map[string]any{"label": "温情陪伴"}, "userStyle": map[string]any{"name": "奶油晨光"}}
	if label := commerceStudioDirectionLabel(strategy, draft); label != "奶油晨光" {
		t.Fatalf("user style label = %s", label)
	}
	delete(strategy, "userStyle")
	if label := commerceStudioDirectionLabel(strategy, draft); label != "温情陪伴" {
		t.Fatalf("direction label = %s", label)
	}
	if label := commerceStudioDirectionLabel(nil, CommerceStudioDraft{Style: "healing"}); label != "healing" {
		t.Fatalf("draft style label = %s", label)
	}
}

func TestCommerceStudioDraftMultiVariantNeedsRealVariants(t *testing.T) {
	for _, tc := range []struct {
		draft CommerceStudioDraft
		want  bool
	}{
		{CommerceStudioDraft{}, false},
		{CommerceStudioDraft{Colors: "奶白色"}, false},
		{CommerceStudioDraft{Skus: []CommerceStudioSku{{ID: "a"}}}, false},
		{CommerceStudioDraft{Instruction: "不要组合，不要多色，只拍这一只奶瓶"}, false},
		{CommerceStudioDraft{Skus: []CommerceStudioSku{{ID: "a"}, {ID: "b"}}}, true},
		{CommerceStudioDraft{Colors: "奶白色、樱花粉"}, true},
		{CommerceStudioDraft{Colors: "black / white"}, true},
		{CommerceStudioDraft{Colors: "多色可选"}, true},
		{CommerceStudioDraft{Instruction: "做一张套装组合图"}, true},
		{CommerceStudioDraft{Instruction: "三件装一起展示"}, true},
		{CommerceStudioDraft{Instruction: "Show the bundle of two bottles"}, true},
	} {
		if got := commerceStudioDraftMultiVariant(tc.draft); got != tc.want {
			t.Errorf("%+v: multi variant = %v, want %v", tc.draft, got, tc.want)
		}
	}
}

func TestCommerceStudioDesignMemoryKeepsMoreLayoutListsThanRuns(t *testing.T) {
	memory := &commerceStudioDesignMemory{runs: map[string][][]string{}}
	for run := 0; run < 10; run++ {
		memory.remember("key", []string{fmt.Sprintf("signature-%d", run)}, fmt.Sprintf("layouts:%d", run))
	}
	recent := memory.recent("key")
	if !slices.Contains(recent, "signature-9") || slices.Contains(recent, "signature-6") {
		t.Fatalf("entry memory is not the last %d runs: %v", commerceStudioDesignMemoryRuns, recent)
	}
	if !slices.Contains(recent, "layouts:2") || slices.Contains(recent, "layouts:1") || !slices.Contains(recent, "layouts:9") {
		t.Fatalf("layout memory is not the last %d runs: %v", commerceStudioDesignLayoutRuns, recent)
	}
	for key := 0; key <= commerceStudioDesignMemoryKeys; key++ {
		memory.remember(fmt.Sprintf("key-%d", key), []string{"signature"}, "layouts")
	}
	if len(memory.layouts) != commerceStudioDesignMemoryKeys || memory.recent("key") != nil {
		t.Fatalf("layout memory grew past its bound: %d keys", len(memory.layouts))
	}
}
