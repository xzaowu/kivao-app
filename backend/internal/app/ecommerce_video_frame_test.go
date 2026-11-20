package app

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestProductVideoCasting(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	const key = "portrait"
	const operationID = "812610a7-2ff8-4907-b2d8-2952ca52911b"
	protocol := model.ChannelInterfaceOpenAIImage
	profile := DefaultModelCapabilityConfigForModel(string(protocol), key)
	profile.Image.Size = ImageSizeConfig{Parameter: "size", Values: []string{"1024x1024"}, Default: "1024x1024", Presets: []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024}}}
	for _, row := range []any{
		&model.ChannelModel{ID: "portrait-model", ChannelID: "channel", ModelKey: key, Capability: "image", Protocol: protocol, Enabled: true, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), PriceConfigured: true, BillingMode: "fixed_request", UnitPriceMicrocredits: 30},
		&model.ChannelModelPriceTier{ID: "portrait-tier", ChannelModelID: "portrait-model", Enabled: true, PriceConfigured: true, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 30},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	request := func() CreateTaskRequest {
		return CreateTaskRequest{ProjectID: project.ID, Type: "canvas_image", Operation: "text_to_image", Model: "channel::" + key, Prompt: "原创的成年虚拟模特，平视相机", Input: map[string]any{
			"mode": "image", "config": map[string]any{"channelId": "channel", "model": key, "count": "1", "size": "1024x1024"},
			"metadata": map[string]any{"source": "ecommerce-agent", "stage": ecommerceVideoCastingStage, "ecommerceProjectId": project.ID, "clientOperationId": operationID, "assetTitle": "虚拟模特", "ecommerceVideoQuote": map[string]any{"billingMode": "fixed_request", "amountMicrocredits": 30}},
		}}
	}
	for _, tc := range []string{"image", "video", "audio", "malformed refs", "mask", "count", "layers", "receipt", "price", "no quote", "foreign project", "wrong operation", "wrong task type", "custom model", "image feature", "video feature", "ecommerce feature"} {
		t.Run(tc, func(t *testing.T) {
			r := request()
			meta := r.Input["metadata"].(map[string]any)
			user := "user"
			switch tc {
			case "image", "video", "audio":
				r.Input[map[string]string{"image": "referenceImages", "video": "referenceVideos", "audio": "referenceAudios"}[tc]] = []any{map[string]any{"id": "resource", "storageKey": "resource:resource"}}
			case "malformed refs":
				r.Input["referenceImages"] = map[string]any{"id": "resource"}
			case "mask":
				r.Input["mask"] = map[string]any{"id": "mask"}
			case "count":
				r.Input["capabilityOptions"] = map[string]any{"count": 2}
			case "layers":
				r.Input["config"].(map[string]any)["imageParameters"] = map[string]any{"layerDecomposition": true}
			case "receipt":
				meta["clientOperationId"] = "not-a-receipt"
			case "price":
				meta["ecommerceVideoQuote"].(map[string]any)["amountMicrocredits"] = 29
			case "no quote":
				delete(meta, "ecommerceVideoQuote")
			case "foreign project":
				user = "other"
			case "wrong operation":
				r.Operation = "image_to_image"
			case "wrong task type":
				r.Type = "canvas_text"
			case "custom model":
				r.Input["config"] = map[string]any{"baseUrl": "https://example.com", "model": key}
			default:
				current, e := s.FeatureAvailability()
				if e != nil {
					t.Fatal(e)
				}
				f := current.FeatureAvailability
				original := f
				if tc == "image feature" {
					f.ImageWorkbenchEnabled = false
				} else if tc == "video feature" {
					f.VideoWorkbenchEnabled = false
				} else {
					f.EcommerceVideoEnabled = false
				}
				saveAdmissionFeatures(t, s, f)
				t.Cleanup(func() { saveAdmissionFeatures(t, s, original) })
			}
			if _, err := s.CreateTask(user, r); err == nil {
				t.Fatal("invalid portrait task admitted")
			}
		})
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("project_id=?", project.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unexpected queued tasks %d: %v", count, err)
	}
	row, err := s.CreateTask("user", request())
	if err != nil {
		t.Fatal(err)
	}
	if row.ClientOperationID != operationID {
		t.Fatal("creation lost operation ID")
	}
	var stored model.Task
	if err := db.First(&stored, "id=?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	var bill model.BillingOrder
	if err := db.First(&bill, "id=?", stored.BillingOrderID).Error; err != nil || !bill.ChargeLimitSet || bill.ChargeLimitMicrocredits != 30 {
		t.Fatalf("authorized quote not preserved: %v", err)
	}
	if err := db.Model(&stored).Update("status", "failed").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RetryTask("user", row.ID); err == nil {
		t.Fatal("retry without explicit user confirmation")
	}
	compact := compactTaskHistoryInput(stored)
	if strings.Contains(compact, "ecommerceVideoQuote") {
		t.Fatal("temporary quote leaked into retained input")
	}
	if err := db.Model(&stored).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	stored.Status = model.TaskStatusRunning
	resource := model.Resource{ID: "portrait-result", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 80, Width: 2, Height: 3}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.saveTaskCompletionWithinStorageQuota(&stored, []byte(`{"mode":"image","images":[]}`), nil, false); err == nil {
		t.Fatal("portrait marked complete without an image")
	}
	if err := s.saveTaskCompletionWithinStorageQuota(&stored, []byte(`{"mode":"image","images":[{"resourceId":"portrait-result","storageKey":"resource:portrait-result"}]}`), nil, false); err != nil {
		t.Fatal(err)
	}
	asset, err := s.repo.AssetForUser("user", generationMediaAssetID(row.ID, 0))
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Tags     []string
		Metadata struct{ EcommerceStage, TaskID string }
		Data     struct{ StorageKey string }
	}
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil || !slices.Contains(payload.Tags, "AI 模特") || payload.Metadata.EcommerceStage != ecommerceVideoCastingStage || payload.Metadata.TaskID != row.ID || payload.Data.StorageKey != "resource:"+resource.ID {
		t.Fatalf("missing tagged personal portrait: %v", err)
	}
	if _, err := s.repo.AssetForUser("other", asset.ID); err == nil {
		t.Fatal("portrait visible outside owner")
	}
	detail, err := s.Task("user", row.ID)
	if err != nil || detail.ClientOperationID != operationID {
		t.Fatalf("archived receipt missing: %v", err)
	}
	items, err := s.TasksWithOptions("user", TaskListOptions{ProjectID: project.ID})
	if err != nil || len(items) != 1 || items[0].ClientOperationID != operationID {
		t.Fatalf("list receipt missing: %v", err)
	}
}

func TestProductVideoFrameComposite(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	f := defaultFeatureAvailability()
	f.EcommerceEnabled, f.EcommerceVideoEnabled, f.ImageWorkbenchEnabled, f.VideoWorkbenchEnabled = true, true, true, true
	saveAdmissionFeatures(t, s, f)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	protocol := model.ChannelInterfaceOpenAIImage
	const key = "frame-test"
	// Match a configured OpenAI image editor, including its declared pixel size on both quote and submission.
	editorProfile := func(maxRefs int) *ModelCapabilityConfig {
		p := DefaultModelCapabilityConfigForModel(string(protocol), key)
		p.Image.References.MaxImages = maxRefs
		p.Image.Size = ImageSizeConfig{Parameter: "size", Values: []string{"1024x1024"}, Default: "1024x1024", Presets: []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024}}}
		return p
	}
	profile := editorProfile(2)
	for _, row := range []any{
		&model.ChannelModel{ID: "frame-model", ChannelID: "channel", ModelKey: key, Capability: "image", Protocol: protocol, Enabled: true, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), PriceConfigured: true, BillingMode: "fixed_request", UnitPriceMicrocredits: 30},
		&model.ChannelModelPriceTier{ID: "frame-tier", ChannelModelID: "frame-model", Enabled: true, PriceConfigured: true, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 30},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	const operation = "24d9856a-577b-4820-aac8-333afe599c27"
	request := func() CreateTaskRequest {
		return CreateTaskRequest{ProjectID: project.ID, Type: "canvas_image", Operation: "image_to_image", Model: "channel::" + key, Prompt: "制作一张同框图", Input: map[string]any{
			"mode": "image", "config": map[string]any{"channelId": "channel", "model": key, "count": "1", "size": "1024x1024"},
			"metadata": map[string]any{"source": "ecommerce-agent", "stage": ecommerceVideoFrameStage, "ecommerceProjectId": project.ID, "clientOperationId": operation, "ecommerceVideoQuote": map[string]any{"billingMode": "fixed_request", "amountMicrocredits": 30}},
			"referenceImages": []any{
				map[string]any{"id": "ref-one", "storageKey": "resource:ref-one", "role": "reference", "slotKey": "person"},
				map[string]any{"id": "ref-two", "storageKey": "resource:ref-two", "role": "reference", "slotKey": "product"},
			},
		}}
	}
	for _, tc := range []string{"missing quote", "price changed", "foreign image", "same image", "slots swapped", "extra output", "other project", "missing feature", "empty receipt", "image model accepts just one reference"} {
		t.Run(tc, func(t *testing.T) {
			r := request()
			meta := r.Input["metadata"].(map[string]any)
			img := r.Input["referenceImages"].([]any)[1].(map[string]any)
			switch tc {
			case "missing quote":
				delete(meta, "ecommerceVideoQuote")
			case "price changed":
				meta["ecommerceVideoQuote"].(map[string]any)["amountMicrocredits"] = 29
			case "foreign image":
				img["id"], img["storageKey"] = "private", "resource:private"
			case "same image":
				img["id"], img["storageKey"] = "ref-one", "resource:ref-one"
			case "slots swapped":
				img["slotKey"] = "person"
			case "extra output":
				r.Input["config"].(map[string]any)["count"] = "2"
			case "other project":
				meta["ecommerceProjectId"] = "other-project"
			case "empty receipt":
				delete(meta, "clientOperationId")
			case "missing feature":
				off := f
				off.ImageWorkbenchEnabled = false
				saveAdmissionFeatures(t, s, off)
				defer saveAdmissionFeatures(t, s, f)
			case "image model accepts just one reference":
				one := editorProfile(1)
				if err := db.Model(&model.ChannelModel{}).Where("id=?", "frame-model").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, one)).Error; err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if err := db.Model(&model.ChannelModel{}).Where("id=?", "frame-model").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
						t.Fatal(err)
					}
				})
			}
			if _, err := s.CreateTask("user", r); err == nil {
				t.Fatal("invalid frame task admitted")
			}
		})
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("project_id = ?", project.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected tasks persisted: %d %v", count, err)
	}
	q, err := s.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: key, Intent: ModelRequestIntent{Capability: "image", Operation: "image_to_image", Inputs: map[string]int{"image": 2}, Options: map[string]any{"count": 1, "size": "1024x1024"}}})
	if err != nil || q.AmountMicrocredits != 30 {
		t.Fatalf("quote: %+v %v", q, err)
	}
	out, err := s.CreateTask("user", request())
	if err != nil {
		t.Fatal(err)
	}
	if out.ClientOperationID != operation || out.ProjectID != project.ID {
		t.Fatal("lost caller receipt")
	}
	items, err := s.TasksWithOptions("user", TaskListOptions{ProjectID: project.ID})
	if err != nil || len(items) != 1 || items[0].ClientOperationID != operation {
		t.Fatal("project list cannot reconcile receipt")
	}
	var row model.Task
	if err := db.First(&row, "id = ?", out.ID).Error; err != nil {
		t.Fatal(err)
	}
	var bill model.BillingOrder
	if err := db.First(&bill, "id = ?", row.BillingOrderID).Error; err != nil || !bill.ChargeLimitSet || bill.ChargeLimitMicrocredits != q.AmountMicrocredits {
		t.Fatalf("quote ceiling missing: %v", err)
	}
	if err := db.Model(&row).Update("status", "failed").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RetryTask("user", out.ID); err == nil {
		t.Fatal("generic retry bypassed explicit frame quote")
	}
}
