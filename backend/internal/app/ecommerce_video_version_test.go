package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestEcommerceVideoVersionRecovery(t *testing.T) {
	svc, db, _ := agentMediaFixture(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.VideoWorkbenchEnabled = true, true, true
	saveAdmissionFeatures(t, svc, features)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	const operation = "428a3ed3-0e9d-4419-90e0-7230ccf91470"
	const selection = "channel::seedance-test"
	version := map[string]any{
		"schema": 1, "frame": map[string]any{"resourceId": "ref-one", "name": "商品图", "url": "private-signed-url"},
		"model": selection, "facts": "玻璃瓶身", "purpose": "demo", "shots": []string{"开场", "细节", "收尾"},
		"voice": "试一试", "productName": "香薰", "audience": "通勤", "language": "zh-CN", "region": "新加坡",
		"settings": map[string]any{"seconds": 15, "ratio": "9:16", "resolution": "720p", "generateAudio": true, "apiKey": "private-key"},
	}
	metadata := map[string]any{
		"source": "ecommerce-agent", "stage": "product-video", "ecommerceProjectId": project.ID,
		"videoStartFrameNodeId": "ref-one", "clientOperationId": operation, "ecommerceVideoVersion": version,
	}
	req := CreateTaskRequest{
		Type: "canvas_video", Operation: "image_to_video", Prompt: "香薰商品展示", ProjectID: project.ID, Model: selection,
		Input: map[string]any{
			"mode": "video", "metadata": metadata,
			"config":          map[string]any{"channelId": "channel", "model": "seedance-test", "videoSeconds": "15", "size": "9:16", "vquality": "720p", "videoGenerateAudio": "true"},
			"referenceImages": []any{map[string]any{"id": "ref-one", "storageKey": "resource:ref-one", "role": "first_frame"}},
		},
	}
	created, err := svc.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	parent, err := svc.repo.TaskForUser("user", created.ID)
	if err != nil || strings.Contains(parent.InputJSON, "private-") {
		t.Fatal("unknown snapshot properties persisted")
	}
	// An old row containing additional fields must still use the whitelist on read.
	metadata["providerOptions"] = map[string]any{"token": "private-token"}
	encoded, _ := json.Marshal(req.Input)
	if err := db.Model(parent).Update("input_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	assertCompletedProductVideoHistory(t, svc, parent.ID, operation)
	list, err := svc.TasksWithOptions("user", TaskListOptions{ProjectID: project.ID})
	if err != nil || len(list) != 1 {
		t.Fatalf("list length=%d, err=%v", len(list), err)
	}
	detail, err := svc.Task("user", parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, ctx := range []*TaskClientContext{created.ClientContext, list[0].ClientContext, detail.ClientContext} {
		if ctx == nil || ctx.EcommerceVideoVersion == nil {
			t.Fatal("missing submitted script")
		}
		v := ctx.EcommerceVideoVersion
		if v.Model != selection || v.Shots[0] != "开场" || v.Frame.Name != "商品图" || v.Frame.Source != "" || !v.Settings.GenerateAudio || v.Voice != "试一试" || v.Region != "新加坡" || v.Language != "zh-CN" || v.Boards != nil || v.ShootBrief != nil {
			t.Fatal("submitted script changed")
		}
	}
	public, _ := json.Marshal([]any{list, detail})
	if strings.Contains(string(public), "private-") || list[0].ClientOperationID != operation || detail.ClientOperationID != operation {
		t.Fatal("private metadata exposed or receipt lost")
	}
	foreign, err := svc.TasksWithOptions("other", TaskListOptions{ProjectID: project.ID})
	if err != nil || len(foreign) != 0 {
		t.Fatalf("foreign list length=%d, err=%v", len(foreign), err)
	}
	if _, err := svc.Task("other", parent.ID); err == nil {
		t.Fatal("foreign task visible")
	}
	t.Run("visual storyboard is a recoverable planning snapshot", func(t *testing.T) {
		const op = "045416ef-0810-4b5f-8a64-2816fac4e98e"
		input, err := normalizeTaskInput(req.Input)
		if err != nil {
			t.Fatal(err)
		}
		meta := input["metadata"].(map[string]any)
		meta["clientOperationId"] = op
		snapshot := meta["ecommerceVideoVersion"].(map[string]any)
		snapshot["boards"] = []any{
			map[string]any{"framing": "wide", "camera": "static"},
			map[string]any{"framing": "detail", "camera": "push", "frame": map[string]any{"resourceId": "ref-two", "name": "瓶盖细节", "url": "private-board-location"}},
			map[string]any{},
		}
		snapshot["shootBrief"] = map[string]any{"scene": "桌边自然光", "closing": "定格在瓶身", "secret": "private-shoot-brief"}
		snapshot["parentTaskId"] = parent.ID
		candidate := req
		candidate.Input = input
		created, err := svc.CreateTask("user", candidate)
		if err != nil {
			t.Fatal(err)
		}
		v := created.ClientContext.EcommerceVideoVersion
		if len(v.Boards) != 3 || v.Boards[0].Framing != "wide" || v.Boards[0].Camera != "static" || v.Boards[0].Frame != nil ||
			v.Boards[1].Frame == nil || v.Boards[1].Frame.ResourceID != "ref-two" || v.Boards[1].Frame.Name != "瓶盖细节" || v.Boards[1].Camera != "push" || v.Boards[2].Frame != nil ||
			v.ShootBrief == nil || v.ShootBrief.Scene != "桌边自然光" || v.ShootBrief.Closing != "定格在瓶身" || v.ParentTaskID != parent.ID {
			t.Fatal("submitted board, scene, closing, or lineage changed")
		}
		stored, err := svc.repo.TaskForUser("user", created.ID)
		if err != nil || strings.Contains(stored.InputJSON, "private-board-location") || strings.Contains(stored.InputJSON, "private-shoot-brief") {
			t.Fatal("private storyboard field survived in the task")
		}
		var persisted map[string]any
		if err := json.Unmarshal([]byte(stored.InputJSON), &persisted); err != nil {
			t.Fatal(err)
		}
		refs, _ := persisted["referenceImages"].([]any)
		if len(refs) != 1 || refs[0].(map[string]any)["id"] != "ref-one" || ModelRequestIntentFromTaskInput(persisted, candidate.Type, candidate.Operation).Inputs["image"] != 1 {
			t.Fatal("planning frame affected model input or billing image count")
		}
		assertCompletedProductVideoHistory(t, svc, created.ID, op)

		for _, row := range []model.Resource{
			{ID: "board-video", UserID: "user", Status: "ready", Kind: "video", MimeType: "video/mp4"},
			{ID: "board-pending", UserID: "user", Status: "pending", Kind: "image", MimeType: "image/jpeg"},
		} {
			if err := db.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
		}
		slot := func(id string) any {
			return map[string]any{"frame": map[string]any{"resourceId": id, "name": "素材"}}
		}
		for _, invalid := range []any{
			[]any{}, []any{slot("ref-one")}, []any{nil, nil, nil}, []any{slot("private"), slot("ref-two"), slot("ref-two")},
			[]any{slot("board-video"), slot("ref-two"), slot("ref-two")}, []any{slot("board-pending"), slot("ref-two"), slot("ref-two")},
			[]any{slot(""), slot("ref-two"), slot("ref-two")}, []any{map[string]any{"framing": "invented"}, map[string]any{}, map[string]any{}},
			[]any{map[string]any{"camera": "invented"}, map[string]any{}, map[string]any{}},
		} {
			snapshot["boards"] = invalid
			if _, err := svc.CreateTask("user", candidate); err == nil {
				t.Fatal("invalid board admitted")
			}
		}
		snapshot["boards"] = []any{map[string]any{}, map[string]any{}, map[string]any{}}
		for _, field := range []string{"scene", "closing"} {
			snapshot["shootBrief"] = map[string]any{field: strings.Repeat("光", 241)}
			if _, err := svc.CreateTask("user", candidate); err == nil {
				t.Fatalf("oversized %s admitted", field)
			}
		}
		snapshot["shootBrief"] = map[string]any{"scene": strings.Repeat("光", 240)}
		if err := svc.prepareEcommerceVideoVersion("user", candidate, candidate.Input); err != nil {
			t.Fatalf("blank shot slots or valid 240-character scene rejected: %v", err)
		}
	})
	t.Run("library first frame", func(t *testing.T) {
		for _, row := range []model.Resource{
			{ID: "not-ready", UserID: "user", Kind: "image", MimeType: "image/png", Status: "pending"},
			{ID: "not-image", UserID: "user", Kind: "file", MimeType: "image/png", Status: "ready"},
		} {
			if err := db.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
		}
		const libraryOperation = "917b68bd-6616-490e-adc2-a5ff891483cc"
		for _, tc := range []struct {
			name, id, wireID, role string
			source                 any
			valid                  bool
		}{
			{"owned", "ref-one", "ref-one", "first_frame", "library", true},
			{"foreign", "private", "private", "first_frame", "library", false},
			{"pending", "not-ready", "not-ready", "first_frame", "library", false},
			{"wrong kind", "not-image", "not-image", "first_frame", "library", false},
			{"wrong identity", "ref-one", "ref-two", "first_frame", "library", false},
			{"wrong role", "ref-one", "ref-one", "reference", "library", false},
			{"unknown source", "ref-one", "ref-one", "first_frame", "other", false},
			{"foreign with source omitted", "private", "private", "first_frame", "", false},
			{"pending with source omitted", "not-ready", "not-ready", "first_frame", "", false},
			{"wrong kind with source omitted", "not-image", "not-image", "first_frame", "", false},
			{"null source", "ref-one", "ref-one", "first_frame", nil, false},
		} {
			t.Run(tc.name, func(t *testing.T) {
				candidate := req
				input, err := normalizeTaskInput(req.Input)
				if err != nil {
					t.Fatal(err)
				}
				candidate.Input = input
				meta := input["metadata"].(map[string]any)
				meta["videoStartFrameNodeId"], meta["clientOperationId"] = tc.id, libraryOperation
				frame := meta["ecommerceVideoVersion"].(map[string]any)["frame"].(map[string]any)
				frame["resourceId"] = tc.id
				if tc.source != "" {
					frame["source"] = tc.source
				}
				image := input["referenceImages"].([]any)[0].(map[string]any)
				image["id"], image["storageKey"], image["role"] = tc.wireID, "resource:"+tc.id, tc.role
				task, err := svc.CreateTask("user", candidate)
				if (err == nil) != tc.valid {
					t.Fatalf("admission: %v, want allowed=%v", err, tc.valid)
				}
				if tc.valid {
					if task.ClientContext == nil || task.ClientContext.EcommerceVideoVersion == nil || task.ClientContext.EcommerceVideoVersion.Frame.Source != model.EcommerceVideoFrameLibrary {
						t.Fatal("submitted version lost the library frame source")
					}
					assertCompletedProductVideoHistory(t, svc, task.ID, libraryOperation)
				}
			})
		}
	})
	version["parentTaskId"] = parent.ID
	if err := svc.prepareEcommerceVideoVersion("other", req, req.Input); err == nil {
		t.Fatal("a different user could derive this version")
	}
	otherProject, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	otherReq := req
	otherReq.ProjectID = otherProject.ID
	metadata["ecommerceProjectId"] = otherProject.ID
	if err := svc.prepareEcommerceVideoVersion("user", otherReq, req.Input); err == nil {
		t.Fatal("a different project could derive this version")
	}
	metadata["ecommerceProjectId"] = project.ID
	for _, tc := range []struct {
		name, parent, frame, taskType string
		good                          bool
	}{
		{"derived", parent.ID, "ref-one", "canvas_video", true},
		{"missing parent", "unknown", "ref-one", "canvas_video", false},
		{"different frame", parent.ID, "another", "canvas_video", false},
		{"wrong task", parent.ID, "ref-one", "canvas_image", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req.Type = tc.taskType
			version["parentTaskId"] = tc.parent
			metadata["ecommerceVideoVersion"] = version
			metadata["videoStartFrameNodeId"] = tc.frame
			if err := svc.prepareEcommerceVideoVersion("user", req, req.Input); (err == nil) != tc.good {
				t.Fatalf("admission=%v, allowed=%v", err, tc.good)
			}
		})
	}
	for _, changed := range []model.Task{
		{ProjectID: "different", Type: "canvas_video", InputJSON: parent.InputJSON},
		{ProjectID: project.ID, Type: "canvas_text", InputJSON: parent.InputJSON},
		{ProjectID: project.ID, Type: "canvas_video", InputJSON: `{"mode":"video","metadata":{"source":"ecommerce-agent","stage":"product-video"}}`},
	} {
		ctx, _ := taskOutputContext(changed)
		if ctx != nil && ctx.EcommerceVideoVersion != nil {
			t.Fatal("fabricated history for unrelated or older task")
		}
	}
}

func TestEcommerceReferenceVideoVersion(t *testing.T) {
	svc, db, _ := agentMediaFixture(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.VideoWorkbenchEnabled = true, true, true
	saveAdmissionFeatures(t, svc, features)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []model.Resource{
		{ID: "clip", UserID: "user", Kind: "video", MimeType: "video/mp4", Status: "ready", DurationMs: 5150, Size: 1024},
		{ID: "other-clip", UserID: "other", Kind: "video", MimeType: "video/mp4", Status: "ready", DurationMs: 5150},
		{ID: "pending-clip", UserID: "user", Kind: "video", MimeType: "video/mp4", Status: "pending", DurationMs: 5150},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	const selection = "channel::seedance-test"
	newRequest := func() (CreateTaskRequest, map[string]any, map[string]any, map[string]any) {
		ref := map[string]any{"resourceId": "clip", "name": "参考片", "durationMs": 5150, "aspects": []string{"rhythm", "camera"}, "instruction": "参考推进镜头", "url": "private-preview"}
		version := map[string]any{
			"schema": 1, "model": selection, "frame": map[string]any{"resourceId": "ref-one", "name": "商品图"}, "referenceVideo": ref,
			"purpose": "showcase", "shots": []string{"开场", "细节", "收尾"}, "settings": map[string]any{"ratio": "9:16", "resolution": "720p", "seconds": 15, "generateAudio": true},
		}
		image := map[string]any{"id": "ref-one", "storageKey": "resource:ref-one", "role": "reference"}
		clip := map[string]any{"id": "clip", "storageKey": "resource:clip", "durationMs": 5150, "role": "reference", "bytes": 1}
		return CreateTaskRequest{Type: "canvas_video", Operation: "reference_to_video", Prompt: "参考推进镜头拍摄玻璃瓶", ProjectID: project.ID, Model: selection, Input: map[string]any{
			"mode": "video", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "product-video", "ecommerceProjectId": project.ID, "ecommerceVideoVersion": version, "videoEditOperation": "reference_to_video"},
			"config":          map[string]any{"channelId": "channel", "model": "seedance-test", "videoSeconds": "15", "size": "9:16", "vquality": "720p", "videoGenerateAudio": "true"},
			"referenceImages": []any{image}, "referenceVideos": []any{clip},
		}}, ref, image, clip
	}
	quote, err := svc.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "seedance-test", Intent: ModelRequestIntent{
		Capability: "video", Operation: "reference_to_video", Inputs: map[string]int{"image": 1, "video": 1}, ReferenceVideoDurationsMs: []int64{5150}, Options: map[string]any{"videoSeconds": 15, "size": "9:16", "vquality": "720p", "videoGenerateAudio": true},
	}})
	if err != nil {
		t.Fatal(err)
	}
	req, _, _, _ := newRequest()
	metadata := req.Input["metadata"].(map[string]any)
	const operation = "835371fa-47ac-4831-a67f-3e59f716c615"
	metadata["clientOperationId"] = operation
	for _, invalid := range []any{nil, map[string]any{"billingMode": "per_second"}, map[string]any{"billingMode": "per_second", "amountMicrocredits": 0}, map[string]any{"billingMode": "fixed_request", "amountMicrocredits": quote.AmountMicrocredits}} {
		metadata["ecommerceVideoQuote"] = invalid
		if _, err := svc.CreateTask("user", req); err == nil {
			t.Fatal("missing or stale quote accepted")
		}
	}
	for _, table := range []any{&model.Task{}, &model.BillingOrder{}} {
		var count int64
		if err := db.Model(table).Where("user_id = ?", "user").Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("quote rejection created a task or billing order: count %d, err %v", count, err)
		}
	}
	metadata["ecommerceVideoQuote"] = map[string]any{"billingMode": quote.BillingMode, "amountMicrocredits": quote.AmountMicrocredits}
	for _, protocolID := range []string{"newapi", "seedance-videos-compatible"} {
		if err := db.Model(&model.ChannelModel{}).Where("id = ?", "video-cm").Update("protocol", protocolID).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := svc.CreateTask("user", req); err == nil {
			t.Fatalf("accepted reference task with incompatible channel %s", protocolID)
		}
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "video-cm").Update("protocol", model.ChannelInterfaceVolcengineArkVideo).Error; err != nil {
		t.Fatal(err)
	}
	task, err := svc.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := svc.Task("user", task.ID)
	if err != nil || detail.ClientContext == nil || detail.ClientContext.EcommerceVideoVersion == nil {
		t.Fatalf("recover reference task: %v", err)
	}
	restored := detail.ClientContext.EcommerceVideoVersion.ReferenceVideo
	if restored == nil || restored.ResourceID != "clip" || restored.DurationMs != 5150 || strings.Join(restored.Aspects, ",") != "rhythm,camera" || restored.Instruction != "参考推进镜头" {
		t.Fatalf("unexpected recovered reference: %+v", restored)
	}
	saved, err := svc.repo.TaskForUser("user", task.ID)
	if err != nil || strings.Contains(saved.InputJSON, "private-preview") || !strings.Contains(saved.InputJSON, `"bytes":1024`) {
		t.Fatalf("reference input was not canonicalized: %v", err)
	}
	order, err := svc.repo.BillingOrder(saved.BillingOrderID)
	if err != nil || !order.ChargeLimitSet || order.ChargeLimitMicrocredits != quote.AmountMicrocredits {
		t.Fatalf("confirmed amount was not preserved on the order: %v", err)
	}
	assertCompletedProductVideoHistory(t, svc, task.ID, operation)
	childReq, _, _, _ := newRequest()
	childMetadata := childReq.Input["metadata"].(map[string]any)
	childMetadata["ecommerceVideoVersion"].(map[string]any)["parentTaskId"] = task.ID
	childMetadata["ecommerceVideoQuote"] = metadata["ecommerceVideoQuote"]
	const childOperation = "77845330-f26c-413a-bdf4-2f410bd1e5ee"
	childMetadata["clientOperationId"] = childOperation
	child, err := svc.CreateTask("user", childReq)
	if err != nil || child.ClientContext == nil || child.ClientContext.EcommerceVideoVersion.ParentTaskID != task.ID {
		t.Fatalf("failed to derive from completed reference video: %v", err)
	}
	assertCompletedProductVideoHistory(t, svc, child.ID, childOperation)
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "video-tier").Update("unit_price_microcredits", 2).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTask("user", req); err == nil {
		t.Fatal("a price increase after confirmation must not enqueue the task")
	}
	for _, tc := range []struct {
		name   string
		change func(CreateTaskRequest, map[string]any, map[string]any, map[string]any)
	}{
		{"forged duration", func(_ CreateTaskRequest, ref, _, clip map[string]any) { ref["durationMs"], clip["durationMs"] = 1, 1 }},
		{"foreign clip", func(_ CreateTaskRequest, ref, _, clip map[string]any) {
			ref["resourceId"], clip["storageKey"] = "other-clip", "resource:other-clip"
		}},
		{"not ready", func(_ CreateTaskRequest, ref, _, clip map[string]any) {
			ref["resourceId"], clip["storageKey"] = "pending-clip", "resource:pending-clip"
		}},
		{"image as video", func(_ CreateTaskRequest, ref, _, clip map[string]any) {
			ref["resourceId"], clip["storageKey"] = "ref-two", "resource:ref-two"
		}},
		{"unexpected remote URL", func(_ CreateTaskRequest, _, _, clip map[string]any) {
			clip["url"] = "https://example.invalid/video.mp4"
		}},
		{"image as frame", func(_ CreateTaskRequest, _, image, _ map[string]any) { image["role"] = "first_frame" }},
		{"conflicting frame metadata", func(req CreateTaskRequest, _, _, _ map[string]any) {
			req.Input["metadata"].(map[string]any)["videoStartFrameNodeId"] = "ref-one"
		}},
		{"different clip", func(_ CreateTaskRequest, _, _, clip map[string]any) { clip["storageKey"] = "resource:other-clip" }},
		{"extra clip", func(req CreateTaskRequest, _, _, clip map[string]any) {
			req.Input["referenceVideos"] = []any{clip, clip}
		}},
		{"no clip", func(req CreateTaskRequest, _, _, _ map[string]any) { delete(req.Input, "referenceVideos") }},
		{"silent output with narration", func(req CreateTaskRequest, _, _, _ map[string]any) {
			version := req.Input["metadata"].(map[string]any)["ecommerceVideoVersion"].(map[string]any)
			version["voice"] = "这是一款玻璃杯"
			version["settings"].(map[string]any)["generateAudio"] = false
			req.Input["config"].(map[string]any)["videoGenerateAudio"] = "false"
			encoded, err := json.Marshal(version)
			if err != nil || decodeEcommerceVideoVersion(encoded, "", "reference_to_video") == nil {
				t.Fatal("existing silent version with narration should still open")
			}
		}},
		{"unknown aspect", func(_ CreateTaskRequest, ref, _, _ map[string]any) { ref["aspects"] = []string{"branding"} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, ref, image, clip := newRequest()
			tc.change(req, ref, image, clip)
			if err := svc.prepareEcommerceVideoVersion("user", req, req.Input); err == nil {
				t.Fatal("invalid reference admitted")
			}
		})
	}
}

func TestEcommerceVideoStoryboardInputs(t *testing.T) {
	svc, db, _ := agentMediaFixture(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.VideoWorkbenchEnabled = true, true, true
	saveAdmissionFeatures(t, svc, features)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.Resource{ID: "detail", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/jpeg", Size: 85},
		&model.ChannelModelPriceTier{ID: "three-img", ChannelModelID: "video-cm", SelectorKey: `{"imageCount":"3"}`, SelectorJSON: `{"imageCount":"3"}`, BillingMode: "per_second", UnitPriceMicrocredits: 3, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	intent := ModelRequestIntent{Capability: "video", Operation: "reference_to_video", Inputs: map[string]int{"image": 3}, Options: map[string]any{"videoSeconds": 15, "size": "9:16", "vquality": "720p", "videoGenerateAudio": true}}
	quote, err := svc.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "seedance-test", Intent: intent})
	if err != nil || quote.AmountMicrocredits != 45 {
		t.Fatalf("three-image quote = %+v, %v", quote, err)
	}
	const op = "47ae4fd0-5ccc-4497-92e3-86d84379bd88"
	const selection = "channel::seedance-test"
	const prompt = "商品外观以参考图1为准。参考图2展示包装，参考图3展示产品细节。"
	board := func(id string) any {
		return map[string]any{"frame": map[string]any{"resourceId": id, "name": "分镜参考"}}
	}
	image := func(id string) any {
		return map[string]any{"id": id, "storageKey": "resource:" + id, "role": "reference"}
	}
	newRequest := func() CreateTaskRequest {
		version := map[string]any{
			"schema": 1, "boardInputs": true, "model": selection, "frame": map[string]any{"resourceId": "ref-one", "name": "主商品图"},
			"purpose": "demo", "shots": []string{"开场", "展示", "收尾"}, "boards": []any{board("ref-two"), board("detail"), board("ref-two")},
			"settings": map[string]any{"seconds": 15, "ratio": "9:16", "resolution": "720p", "generateAudio": true},
		}
		return CreateTaskRequest{Type: "canvas_video", Operation: intent.Operation, Model: selection, ProjectID: project.ID, Prompt: prompt, Input: map[string]any{
			"mode": "video", "prompt": prompt, "referenceImages": []any{image("ref-one"), image("ref-two"), image("detail")},
			"config": map[string]any{"channelId": "channel", "model": "seedance-test", "videoSeconds": "15", "size": "9:16", "vquality": "720p", "videoGenerateAudio": "true"},
			"metadata": map[string]any{"source": "ecommerce-agent", "stage": "product-video", "ecommerceProjectId": project.ID, "clientOperationId": op, "videoEditOperation": intent.Operation,
				"ecommerceVideoVersion": version, "ecommerceVideoQuote": map[string]any{"amountMicrocredits": quote.AmountMicrocredits, "billingMode": quote.BillingMode}},
		}}
	}
	req := newRequest()
	created, err := svc.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.repo.TaskForUser("user", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.repo.BillingOrder(saved.BillingOrderID)
	if err != nil || !order.ChargeLimitSet || order.AmountMicrocredits != quote.AmountMicrocredits || order.ChargeLimitMicrocredits != quote.AmountMicrocredits {
		t.Fatalf("wrong order for three input images: %+v %v", order, err)
	}
	var worker canvasGenerationInput
	if err := json.Unmarshal([]byte(saved.InputJSON), &worker); err != nil {
		t.Fatal(err)
	}
	for i, id := range []string{"ref-one", "ref-two", "detail"} {
		if len(worker.ReferenceImages) != 3 || worker.ReferenceImages[i].ID != id || worker.ReferenceImages[i].Role != "reference" {
			t.Fatal("worker did not receive the unique frames in storyboard order")
		}
		worker.ReferenceImages[i].URL = "https://media.example/" + id
	}
	if worker.ReferenceImages[2].Bytes != 85 || worker.ReferenceImages[2].MimeType != "image/jpeg" || !created.ClientContext.EcommerceVideoVersion.BoardInputs {
		t.Fatal("resource metadata or board input mode missing")
	}
	fixtures := []struct {
		id, model, resolution, array, role string
	}{
		{"volcengine-ark-video", "seedance-2.0", "720p", "content", "reference_image"},
		{"volcengine-ark-seedance-25", "doubao-seedance-2-5-260628", "720p", "content", "reference_image"},
		{"seedance-videos-compatible", "seedance-2.0", "720p", "images", ""},
		{"minimax-video", "MiniMax-H3", "768p", "content", "reference_image"},
		{"metaso-h3", "MiniMax-H3", "768p", "content", "reference_image"},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.id+" manifest", func(t *testing.T) {
			input := worker
			input.Config.InterfaceType, input.Config.Model, input.Config.VQuality = fixture.id, fixture.model, fixture.resolution
			request := protocolRequestFromInput(input)
			spec := buildDramaReferenceSpec(t, input, request)
			legacyPlan, err := prepareDramaReferencePlan(input, request, protocol.Metadata{ID: fixture.id})
			if err != nil {
				t.Fatalf("existing release without reference metadata: %v", err)
			}
			if err := legacyPlan.compile(request, &spec, input.VideoCapability); err != nil {
				t.Fatal(err)
			}
			spec = buildDramaReferenceSpec(t, input, request)
			if err := compileDramaReferenceRequest(input, request, &spec, fixture.id); err != nil {
				t.Fatal(err)
			}
			body := spec.Body.(map[string]any)
			if seconds, ok := workbenchInteger(body["duration"], 3600); !ok || seconds != 15 {
				t.Fatal("actual adapter did not request the confirmed 15 seconds")
			}
			var urls []string
			for _, item := range body[fixture.array].([]any) {
				if fixture.array == "images" {
					urls = append(urls, item.(string))
					continue
				}
				part := item.(map[string]any)
				if part["type"] == "image_url" {
					if part["role"] != fixture.role {
						t.Fatalf("unexpected image role: %v", part["role"])
					}
					urls = append(urls, stringField(part["image_url"].(map[string]any), "url"))
				}
			}
			if len(urls) != len(input.ReferenceImages) {
				t.Fatalf("unexpected number of images: %d", len(urls))
			}
			for i, url := range urls {
				if url != input.ReferenceImages[i].URL {
					t.Fatal("actual adapter did not send the expected image in order")
				}
			}
			spec = buildDramaReferenceSpec(t, input, request)
			body = spec.Body.(map[string]any)
			items := body[fixture.array].([]any)
			body[fixture.array] = items[:len(items)-1]
			if err := compileDramaReferenceRequest(input, request, &spec, fixture.id); err == nil {
				t.Fatal("adapter omitted a bound image but its request could still be sent")
			}
		})
	}
	assertCompletedProductVideoHistory(t, svc, created.ID, op)

	for _, tc := range []struct {
		name string
		edit func(map[string]any, map[string]any, map[string]any)
	}{
		{"dropped photo", func(input, _, _ map[string]any) { input["referenceImages"] = input["referenceImages"].([]any)[:2] }},
		{"reordered", func(input, _, _ map[string]any) {
			refs := input["referenceImages"].([]any)
			refs[1], refs[2] = refs[2], refs[1]
		}},
		{"duplicate", func(input, _, _ map[string]any) { refs := input["referenceImages"].([]any); refs[2] = refs[1] }},
		{"foreign", func(input, _, version map[string]any) {
			version["boards"].([]any)[1] = board("private")
			input["referenceImages"].([]any)[2] = image("private")
		}},
		{"alternate URL", func(input, _, _ map[string]any) {
			input["referenceImages"].([]any)[1].(map[string]any)["url"] = "https://media.example/other"
		}},
		{"first frame", func(input, _, _ map[string]any) {
			input["referenceImages"].([]any)[0].(map[string]any)["role"] = "first_frame"
		}},
		{"end frame", func(_, metadata, _ map[string]any) { metadata["videoEndFrameNodeId"] = "detail" }},
		{"additional clip", func(input, _, _ map[string]any) { input["referenceVideos"] = []any{image("clip")} }},
		{"undisclosed board", func(_, _, version map[string]any) { delete(version, "boardInputs") }},
		{"missing quote", func(_, metadata, _ map[string]any) { delete(metadata, "ecommerceVideoQuote") }},
		{"stale single-photo price", func(_, metadata, _ map[string]any) {
			metadata["ecommerceVideoQuote"].(map[string]any)["amountMicrocredits"] = 15
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := newRequest()
			metadata := req.Input["metadata"].(map[string]any)
			tc.edit(req.Input, metadata, metadata["ecommerceVideoVersion"].(map[string]any))
			if _, err := svc.CreateTask("user", req); err == nil {
				t.Fatal("invalid multi-image task admitted")
			}
		})
	}
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "seedance-test")
	profile.Video.References.MaxImages = 2
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "video-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTask("user", newRequest()); err == nil {
		t.Fatal("model limit changed after quotation but generation was allowed")
	}
	profile.Video.References.MaxImages = 3
	for _, protocolID := range []string{"newapi", "unverified-video"} {
		if err := db.Model(&model.ChannelModel{}).Where("id = ?", "video-cm").Updates(map[string]any{
			"protocol": protocolID, "capability_config_json": mustEncodeModelCapabilityConfig(t, profile),
		}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := svc.CreateTask("user", newRequest()); err == nil {
			t.Fatalf("unverified multi-image protocol %s admitted a task with bound board images", protocolID)
		}
	}
	item, err := svc.repo.ChannelModelByKey("channel", "seedance-test")
	if err != nil {
		t.Fatal(err)
	}
	checkCatalog := func(protocolID string, want bool) {
		t.Helper()
		item.Protocol = model.ChannelInterfaceType(protocolID)
		public, err := svc.sanitizeChannelModel(item)
		if err != nil {
			t.Fatal(err)
		}
		video := public.CapabilityConfig["video"].(map[string]any)
		if _, exists := video["numberedImageReferences"]; exists != want || (exists && video["numberedImageReferences"] != true) {
			t.Fatalf("public protocol capability differs from admission for %s", protocolID)
		}
	}
	for _, fixture := range fixtures {
		checkCatalog(fixture.id, true)
	}
	checkCatalog("unverified-video", false)
	checkCatalog(string(model.ChannelInterfaceNewAPIVideo), false)
	profile.Video.References.MaxImages = 1
	item.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, profile)
	checkCatalog("seedance-videos-compatible", true)
	profile.Video.References.MaxImages = 0
	item.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, profile)
	checkCatalog("seedance-videos-compatible", false)
	for _, table := range []any{&model.Task{}, &model.BillingOrder{}} {
		var count int64
		if err := db.Model(table).Where("user_id = ?", "user").Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("expected one task and one order, count=%d, err=%v", count, err)
		}
	}
}

func TestEcommerceVideoProductReferences(t *testing.T) {
	svc, db, _ := agentMediaFixture(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.VideoWorkbenchEnabled = true, true, true
	saveAdmissionFeatures(t, svc, features)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"detail", "scene"} {
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: "ready", MimeType: "image/webp", Size: 256}).Error; err != nil {
			t.Fatal(err)
		}
	}
	photo := func(id string) map[string]any {
		return map[string]any{"resourceId": id, "name": id, "source": "library"}
	}
	newRequest := func(ids, wire []string, includeBoards bool) CreateTaskRequest {
		products := make([]any, 0, len(ids))
		for _, id := range ids {
			products = append(products, photo(id))
		}
		version := map[string]any{
			"schema": 1, "model": "channel::seedance-test", "productImages": products, "frame": photo("ref-one"), "purpose": "demo", "shots": []string{"开场", "使用", "选购"},
			"settings": map[string]any{"seconds": 15, "ratio": "9:16", "resolution": "720p"},
			"boards":   []any{map[string]any{"frame": photo("ref-one")}, map[string]any{"frame": photo("scene")}, map[string]any{}}, "boardInputs": includeBoards,
		}
		refs := []any{}
		prompt := ""
		for i, id := range wire {
			refs = append(refs, map[string]any{"id": id, "storageKey": "resource:" + id, "role": "reference"})
			prompt += fmt.Sprintf("参考图%d中的同一件商品。", i+1)
		}
		return CreateTaskRequest{Type: "canvas_video", Operation: "reference_to_video", Model: "channel::seedance-test", Prompt: prompt, ProjectID: project.ID, Input: map[string]any{
			"mode": "video", "prompt": prompt, "referenceImages": refs, "config": map[string]any{"channelId": "channel", "model": "seedance-test", "videoSeconds": "15", "size": "9:16", "vquality": "720p", "videoGenerateAudio": "false"},
			"metadata": map[string]any{"source": "ecommerce-agent", "stage": "product-video", "ecommerceProjectId": project.ID, "videoEditOperation": "reference_to_video", "clientOperationId": uuid.NewString(),
				"ecommerceVideoQuote": map[string]any{"billingMode": "per_second", "amountMicrocredits": 15}, "ecommerceVideoVersion": version},
		}}
	}
	for _, tc := range []struct {
		name           string
		products, wire []string
		withBoards     bool
	}{
		{"one", []string{"ref-one"}, []string{"ref-one"}, false},
		{"two", []string{"ref-one", "ref-two"}, []string{"ref-one", "ref-two"}, false},
		{"three", []string{"ref-one", "ref-two", "detail"}, []string{"ref-one", "ref-two", "detail"}, false},
		{"boards reuse product photos", []string{"ref-one", "scene"}, []string{"ref-one", "scene"}, true},
		{"three products plus per-shot reference", []string{"ref-one", "ref-two", "detail"}, []string{"ref-one", "ref-two", "detail", "scene"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := newRequest(tc.products, tc.wire, tc.withBoards)
			task, err := svc.CreateTask("user", req)
			if err != nil {
				t.Fatal(err)
			}
			if task.ClientContext == nil || task.ClientContext.EcommerceVideoVersion == nil {
				t.Fatal("missing editable product references")
			}
			got := task.ClientContext.EcommerceVideoVersion
			if len(got.ProductImages) != len(tc.products) || got.Frame != got.ProductImages[0] {
				t.Fatal("invalid product image snapshot")
			}
			for i, id := range tc.products {
				if got.ProductImages[i].ResourceID != id {
					t.Fatalf("product %d = %s; expected %s", i, got.ProductImages[i].ResourceID, id)
				}
			}
			record, err := svc.repo.TaskForUser("user", task.ID)
			if err != nil {
				t.Fatal(err)
			}
			var worker canvasGenerationInput
			if err := json.Unmarshal([]byte(record.InputJSON), &worker); err != nil {
				t.Fatal(err)
			}
			if len(worker.ReferenceImages) != len(tc.wire) || worker.Metadata["videoStartFrameNodeId"] != nil {
				t.Fatal("wrong wire input count or unexpected first frame")
			}
			for i, id := range tc.wire {
				if worker.ReferenceImages[i].ID != id || worker.ReferenceImages[i].Role != "reference" {
					t.Fatalf("wrong reference #%d", i+1)
				}
				worker.ReferenceImages[i].URL = "https://media.example/" + id
			}
			// In particular, single-image templates sometimes change that image to first_frame.
			for _, adapter := range []struct{ protocol, model, resolution string }{
				{"volcengine-ark-video", "seedance-2.0", "720p"}, {"volcengine-ark-seedance-25", "doubao-seedance-2-5-260628", "720p"},
				{"seedance-videos-compatible", "seedance-2.0", "720p"}, {"minimax-video", "MiniMax-H3", "768p"}, {"metaso-h3", "MiniMax-H3", "768p"},
			} {
				worker.Config.InterfaceType, worker.Config.Model, worker.Config.VQuality = adapter.protocol, adapter.model, adapter.resolution
				request := protocolRequestFromInput(worker)
				spec := buildDramaReferenceSpec(t, worker, request)
				if err := compileDramaReferenceRequest(worker, request, &spec, adapter.protocol); err != nil {
					t.Fatalf("%s: %v", adapter.protocol, err)
				}
			}
			assertCompletedProductVideoHistory(t, svc, task.ID, stringValue(req.Input["metadata"].(map[string]any)["clientOperationId"]))
		})
	}
	for _, tc := range []struct {
		name           string
		products, wire []string
		change         func(map[string]any, map[string]any)
	}{
		{"zero", nil, nil, nil}, {"four", []string{"ref-one", "ref-two", "detail", "scene"}, []string{"ref-one", "ref-two", "detail", "scene"}, nil},
		{"alias mismatch", []string{"ref-two"}, []string{"ref-two"}, nil}, {"duplicate", []string{"ref-one", "ref-one"}, []string{"ref-one", "ref-one"}, nil},
		{"foreign product photo", []string{"ref-one", "private"}, []string{"ref-one", "private"}, nil}, {"wire order", []string{"ref-one", "ref-two"}, []string{"ref-two", "ref-one"}, nil},
		{"first frame role", []string{"ref-one"}, []string{"ref-one"}, func(input, meta map[string]any) {
			input["referenceImages"].([]any)[0].(map[string]any)["role"] = "first_frame"
		}},
		{"first frame metadata", []string{"ref-one"}, []string{"ref-one"}, func(input, meta map[string]any) { meta["videoStartFrameNodeId"] = "ref-one" }},
		{"missing image binding", []string{"ref-one", "ref-two"}, []string{"ref-one", "ref-two"}, func(input, meta map[string]any) { input["prompt"] = "参考图1" }},
		{"no confirmation", []string{"ref-one"}, []string{"ref-one"}, func(input, meta map[string]any) { delete(meta, "ecommerceVideoQuote") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := newRequest(tc.products, tc.wire, false)
			if tc.change != nil {
				tc.change(req.Input, req.Input["metadata"].(map[string]any))
				req.Prompt = req.Input["prompt"].(string)
			}
			if _, err := svc.CreateTask("user", req); err == nil {
				t.Fatal("invalid reference generation admitted")
			}
		})
	}
}

func assertCompletedProductVideoHistory(t *testing.T, svc *Service, taskID, operationID string) {
	t.Helper()
	task, err := svc.repo.TaskForUser("user", taskID)
	if err != nil {
		t.Fatal(err)
	}
	expected, receipt := taskOutputContext(*task)
	if expected == nil || expected.EcommerceVideoVersion == nil || receipt != operationID {
		t.Fatal("missing version before completion")
	}
	if err := svc.saveTaskCompletionWithinStorageQuota(task, []byte(`{"mode":"video"}`), nil, false); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.TaskForUser("user", taskID)
	if err != nil || stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("worker completion did not persist: %v", err)
	}
	if strings.Contains(stored.InputJSON, "private-") || strings.Contains(stored.InputJSON, "referenceImages") || strings.Contains(stored.InputJSON, "referenceVideos") || strings.Contains(stored.InputJSON, "storageKey") || strings.Contains(stored.InputJSON, "ecommerceVideoQuote") {
		t.Fatal("raw provider or input media data survived completion")
	}
	if _, err := svc.MigrateLegacyStorage(); err != nil {
		t.Fatal(err)
	}
	again, err := svc.repo.TaskForUser("user", taskID)
	if err != nil || compactTaskHistoryInput(*again) != stored.InputJSON || again.InputJSON != stored.InputJSON {
		t.Fatalf("history compaction was not idempotent: %v", err)
	}
	detail, err := svc.Task("user", taskID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Status != model.TaskStatusSucceeded || detail.ClientOperationID != operationID || detail.ClientContext == nil || !reflect.DeepEqual(detail.ClientContext.EcommerceVideoVersion, expected.EcommerceVideoVersion) || strings.Contains(detail.InputJSON, "ecommerceVideoVersion") {
		t.Fatal("completed task detail lost the typed version or receipt, or exposed the raw snapshot")
	}
	rows, err := svc.TasksWithOptions("user", TaskListOptions{ProjectID: task.ProjectID})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range rows {
		if row.ID != taskID {
			continue
		}
		found = true
		if row.Status != model.TaskStatusSucceeded || row.ClientOperationID != operationID || row.ClientContext == nil || !reflect.DeepEqual(row.ClientContext.EcommerceVideoVersion, expected.EcommerceVideoVersion) {
			t.Fatal("completed task list lost the typed version or receipt")
		}
	}
	if !found {
		t.Fatal("completed video absent from project history")
	}
}

func TestEcommerceVideoQuoteGuard(t *testing.T) {
	version := &model.EcommerceVideoVersion{ReferenceVideo: &model.EcommerceVideoReference{}}
	check := func(quote any, order *model.BillingOrder) error {
		return applyEcommerceVideoQuote(map[string]any{"metadata": map[string]any{"ecommerceVideoVersion": version, "ecommerceVideoQuote": quote}}, &model.Task{}, order)
	}
	quoted := func(mode string, amount any) map[string]any {
		return map[string]any{"billingMode": mode, "amountMicrocredits": amount}
	}
	free := &model.BillingOrder{BillingMode: "fixed_request", AmountMicrocredits: 0}
	if err := check(quoted("fixed_request", float64(0)), free); err != nil || !free.ChargeLimitSet || free.ChargeLimitMicrocredits != 0 {
		t.Fatalf("zero-price authorization must remain effective: %v", err)
	}
	for _, invalid := range []any{quoted("per_second", float64(-1)), quoted("per_second", 0.5), quoted("per_second", "0"), quoted("per_second", float64(1<<53)), quoted("image_usage", float64(0))} {
		if err := check(invalid, free); err == nil {
			t.Fatal("invalid quote admitted")
		}
	}
	token := &model.BillingOrder{BillingMode: "token", AmountMicrocredits: 200}
	if err := check(quoted("token", float64(100)), token); err != nil || token.ChargeLimitSet {
		t.Fatalf("token estimate treated as final cap: %v", err)
	}
	if err := check(quoted("fixed_request", float64(200)), token); err == nil {
		t.Fatal("billing mode drift accepted")
	}
	svc, channel, item := newPerSecondReferenceFixture(t, true)
	estimated, err := perSecondReferenceOrder(t, svc, channel, item, nil)
	if err != nil {
		t.Fatal(err)
	}
	measured, err := perSecondReferenceOrder(t, svc, channel, item, func() (int64, error) { return 3001, nil })
	if err != nil {
		t.Fatal(err)
	}
	if measured.AmountMicrocredits <= estimated.AmountMicrocredits || check(quoted(estimated.BillingMode, float64(estimated.AmountMicrocredits)), measured) == nil {
		t.Fatal("crossing a billing second must require a new confirmation")
	}
}

func TestEcommercePresenterVideo(t *testing.T) {
	svc, db, _ := agentMediaFixture(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.VideoWorkbenchEnabled = true, true, true
	saveAdmissionFeatures(t, svc, features)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	quote, err := svc.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "seedance-test", Intent: ModelRequestIntent{Capability: "video", Operation: "image_to_video", Inputs: map[string]int{"image": 1}, Options: map[string]any{"videoSeconds": 15, "size": "9:16", "vquality": "720p", "videoGenerateAudio": true}}})
	if err != nil {
		t.Fatal(err)
	}
	const operationID = "9bb6b99d-b1bf-4ad3-8c39-a613c820a9a3"
	newRequest := func() (CreateTaskRequest, map[string]any, map[string]any, map[string]any) {
		frame := map[string]any{"id": "ref-one", "storageKey": "resource:ref-one", "role": "first_frame"}
		presenter := map[string]any{"frameResourceId": "ref-one", "delivery": "answer", "url": "private-portrait-preview"}
		version := map[string]any{"schema": 1, "frame": map[string]any{"resourceId": "ref-one", "name": "同框首帧"}, "model": "channel::seedance-test", "presenter": presenter,
			"purpose": "demo", "shots": []string{"出镜", "展示", "收尾"}, "voice": "请看瓶身刻度", "language": "zh-CN", "settings": map[string]any{"seconds": 15, "ratio": "9:16", "resolution": "720p", "generateAudio": true}}
		metadata := map[string]any{"source": "ecommerce-agent", "stage": "product-video", "ecommerceProjectId": project.ID, "ecommerceVideoVersion": version, "videoStartFrameNodeId": "ref-one", "videoEditOperation": "image_to_video", "clientOperationId": operationID, "ecommerceVideoQuote": map[string]any{"billingMode": quote.BillingMode, "amountMicrocredits": quote.AmountMicrocredits}}
		input := map[string]any{"mode": "video", "metadata": metadata, "prompt": "出镜人演示。口播文案（zh-CN）：请看瓶身刻度", "referenceImages": []any{frame}, "config": map[string]any{"channelId": "channel", "model": "seedance-test", "videoSeconds": "15", "size": "9:16", "vquality": "720p", "videoGenerateAudio": "true"}}
		return CreateTaskRequest{Type: "canvas_video", Operation: "image_to_video", ProjectID: project.ID, Model: "channel::seedance-test", Input: input, Prompt: input["prompt"].(string)}, version, presenter, frame
	}
	req, _, _, _ := newRequest()
	created, err := svc.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	if created.ClientContext == nil || created.ClientContext.EcommerceVideoVersion == nil || created.ClientContext.EcommerceVideoVersion.Presenter.Delivery != "answer" {
		t.Fatal("presenter version missing")
	}
	assertCompletedProductVideoHistory(t, svc, created.ID, operationID)
	for _, tc := range []struct {
		name   string
		change func(CreateTaskRequest, map[string]any, map[string]any, map[string]any)
	}{
		{"unconfirmed frame", func(_ CreateTaskRequest, _, p, _ map[string]any) { p["frameResourceId"] = "ref-two" }},
		{"unrecognized delivery", func(_ CreateTaskRequest, _, p, _ map[string]any) { p["delivery"] = "clone" }},
		{"foreign frame", func(req CreateTaskRequest, v, p, img map[string]any) {
			v["frame"].(map[string]any)["resourceId"] = "private"
			p["frameResourceId"] = "private"
			img["id"], img["storageKey"] = "private", "resource:private"
			req.Input["metadata"].(map[string]any)["videoStartFrameNodeId"] = "private"
		}},
		{"no speech", func(_ CreateTaskRequest, v, _, _ map[string]any) { v["voice"] = "   " }},
		{"different submitted lines", func(req CreateTaskRequest, _, _, _ map[string]any) { req.Input["prompt"] = "另一段台词" }},
		{"no sound", func(req CreateTaskRequest, _, _, _ map[string]any) {
			req.Input["config"].(map[string]any)["videoGenerateAudio"] = "false"
		}},
		{"resolved sound override", func(req CreateTaskRequest, _, _, _ map[string]any) {
			req.Input["capabilityOptions"] = map[string]any{"videoGenerateAudio": false}
		}},
		{"resolved duration override", func(req CreateTaskRequest, _, _, _ map[string]any) {
			req.Input["capabilityOptions"] = map[string]any{"videoSeconds": 5}
		}},
		{"second image", func(req CreateTaskRequest, _, _, img map[string]any) { req.Input["referenceImages"] = []any{img, img} }},
		{"additional video", func(req CreateTaskRequest, _, _, _ map[string]any) {
			req.Input["referenceVideos"] = []any{map[string]any{"id": "extra"}}
		}},
		{"reference mode conflict", func(_ CreateTaskRequest, v, _, _ map[string]any) {
			v["referenceVideo"] = map[string]any{"resourceId": "clip", "durationMs": 1000, "name": "视频"}
		}},
		{"missing quote", func(req CreateTaskRequest, _, _, _ map[string]any) {
			delete(req.Input["metadata"].(map[string]any), "ecommerceVideoQuote")
		}},
		{"higher price", func(req CreateTaskRequest, _, _, _ map[string]any) {
			req.Input["metadata"].(map[string]any)["ecommerceVideoQuote"].(map[string]any)["amountMicrocredits"] = 0
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, v, p, img := newRequest()
			tc.change(req, v, p, img)
			if _, err := svc.CreateTask("user", req); err == nil {
				t.Fatal("invalid presenter task admitted")
			}
		})
	}
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "seedance-test")
	profile.Video.GenerateAudio.Supported = false
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "video-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	req, _, _, _ = newRequest()
	if _, err := svc.CreateTask("user", req); err == nil {
		t.Fatal("a silent model was admitted after its catalog changed")
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("project_id = ?", project.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("unexpected number of submitted tasks: %d, %v", count, err)
	}
}
