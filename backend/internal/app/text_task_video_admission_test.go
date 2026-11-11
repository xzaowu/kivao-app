package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func textTaskWithVideos(channelID, modelKey string, count int) map[string]any {
	videos := make([]any, 0, count)
	for index := 0; index < count; index++ {
		videos = append(videos, map[string]any{"storageKey": "resource:video-" + string(rune('a'+index)), "mimeType": "video/mp4", "bytes": 1024})
	}
	return map[string]any{
		"mode": "text", "prompt": "总结这段视频",
		"referenceVideos": videos,
		"config":          map[string]any{"channelId": channelID, "model": modelKey},
	}
}

func assertTextVideoRejected(t *testing.T, err error, issue, message string) {
	t.Helper()
	var argumentErr *modelCapabilityArgumentError
	if !errors.As(err, &argumentErr) || argumentErr.Field != "referenceNodeIds" || argumentErr.Issue != issue {
		t.Fatalf("text task with videos must be rejected with %s: %#v", issue, err)
	}
	if !strings.Contains(err.Error(), message) {
		t.Fatalf("message = %q, want %q", err.Error(), message)
	}
}

// 视频识别默认关闭：未勾选「支持视频识别」的文本模型在扣费前就拒绝参考视频。
func TestValidateTaskCapabilityRejectsVideosUntilTextVideoUnderstandingEnabled(t *testing.T) {
	svc, channel, channelModel := textVisionFixture(t, 4)
	assertTextVideoRejected(t, svc.ValidateTaskCapability(textTaskWithVideos(channel.ID, channelModel.ModelKey, 1)), "unsupported_value", "当前文字模型未开启视频识别")

	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "qwen-video")
	profile.Text.References.MaxImages = 9
	profile.Text.References.MaxVideos = 2
	videoSvc, _, videoChannel, videoModel := createSystemChannelSelectionFixture(t, "text", model.ChannelInterfaceChatCompletion, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("text-video-tier", `{}`, "provider-text", "fixed_request"),
	})
	if err := videoSvc.ValidateTaskCapability(textTaskWithVideos(videoChannel.ID, videoModel.ModelKey, 2)); err != nil {
		t.Fatalf("video-capable text model must accept up to its limit: %v", err)
	}
	assertTextVideoRejected(t, videoSvc.ValidateTaskCapability(textTaskWithVideos(videoChannel.ID, videoModel.ModelKey, 3)), "item_count", "最多识别 2 个参考视频")
}

func TestValidateTaskCapabilityChecksDeclaredCustomTextVideoCapability(t *testing.T) {
	declared := func(maxVideos int) map[string]any {
		return map[string]any{
			"mode": "text", "prompt": "总结这段视频",
			"referenceVideos": []any{map[string]any{"dataUrl": "https://example.test/a.mp4", "mimeType": "video/mp4"}},
			"config": map[string]any{"interfaceType": string(model.ChannelInterfaceChatCompletion), "model": "custom-text",
				"capabilityConfig": map[string]any{"version": 1, "text": map[string]any{"references": map[string]any{"maxVideos": maxVideos, "promptMaxChars": 32000}}}},
		}
	}
	assertTextVideoRejected(t, (&Service{}).ValidateTaskCapability(declared(0)), "unsupported_value", "当前文字模型未开启视频识别")
	if err := (&Service{}).ValidateTaskCapability(declared(1)); err != nil {
		t.Fatalf("declared video understanding must pass: %v", err)
	}
	undeclared := declared(0)
	delete(undeclared["config"].(map[string]any), "capabilityConfig")
	if err := (&Service{}).ValidateTaskCapability(undeclared); err != nil {
		t.Fatalf("undeclared custom capability must not be inferred: %v", err)
	}
	claude := declared(1)
	claude["config"].(map[string]any)["interfaceType"] = string(model.ChannelInterfaceClaudeAPI)
	assertTextVideoRejected(t, (&Service{}).ValidateTaskCapability(claude), "unsupported_value", "Claude 文本接口不支持参考视频")
}

func TestClaudeTextContentRejectsVideosInsteadOfDroppingThem(t *testing.T) {
	_, err := claudeTextContent(canvasGenerationInput{Prompt: "看视频", ReferenceVideos: []providerMedia{{DataURL: "data:video/mp4;base64,AAAA"}}})
	if err == nil || !strings.Contains(err.Error(), "不支持参考视频") {
		t.Fatalf("Claude text content must refuse videos, got %v", err)
	}
}

func TestValidateTextVideoSizeLimitAndUnknownSystemCapability(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-model")
	profile.Text.References.MaxVideos = 1
	profile.Text.References.MaxVideoBytes = 1024
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "text", model.ChannelInterfaceChatCompletion, profile, nil)
	input := textTaskWithVideos(channel.ID, channelModel.ModelKey, 1)
	if err := svc.ValidateTaskCapability(input); err != nil {
		t.Fatalf("exact byte limit must pass: %v", err)
	}
	input["referenceVideos"].([]any)[0].(map[string]any)["bytes"] = 1025
	assertTextVideoRejected(t, svc.ValidateTaskCapability(input), "unsupported_value", "大小限制")
	if err := db.Model(&channelModel).Update("capability_config_json", `{}`).Error; err != nil {
		t.Fatal(err)
	}
	assertTextVideoRejected(t, svc.ValidateTaskCapability(input), "unsupported_value", "未开启视频识别")
}

func TestCreateTextVideoRejectedBeforeCreditsAndQueue(t *testing.T) {
	for _, tc := range []struct {
		name     string
		protocol model.ChannelInterfaceType
		limit    int
		count    int
		bytes    int64
		message  string
	}{
		{"disabled", model.ChannelInterfaceChatCompletion, 0, 1, 0, ""},
		{"count", model.ChannelInterfaceChatCompletion, 1, 2, 0, ""},
		{"size", model.ChannelInterfaceChatCompletion, 1, 1, 512, "大小限制"},
		{"claude", model.ChannelInterfaceClaudeAPI, 1, 1, 0, "Claude 文本接口不支持参考视频"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db := newMediaRecoveryTestService(t)
			profile := DefaultModelCapabilityConfigForModel(string(tc.protocol), "text-model")
			profile.Text.References.MaxVideos, profile.Text.References.MaxVideoBytes = tc.limit, tc.bytes
			raw, err := json.Marshal(profile)
			if err != nil {
				t.Fatal(err)
			}
			channel := model.ModelChannel{ID: newID(), Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test Channel", APIFormat: "legacy"}
			cm := model.ChannelModel{ID: newID(), ChannelID: channel.ID, ModelKey: "text-model", ProviderModelKey: "provider-text", Capability: "text", Protocol: tc.protocol, Enabled: true, CapabilityConfigJSON: string(raw)}
			tier := newSelectionPriceTier("text-video-tier", `{}`, "provider-text", "fixed_request")
			tier.ChannelModelID = cm.ID
			user := model.User{ID: "text-video-user", Email: "text-video@example.test", Username: "text-video"}
			for _, item := range []any{&channel, &cm, &tier, &user, &model.CreditAccount{UserID: user.ID, AvailableMicrocredits: 1_000_000}} {
				if err := db.Create(item).Error; err != nil {
					t.Fatal(err)
				}
			}
			_, err = svc.CreateTask(user.ID, CreateTaskRequest{Type: "canvas_text", Prompt: "总结视频", Input: textTaskWithVideos(channel.ID, cm.ModelKey, tc.count)})
			if err == nil || tc.message != "" && !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("wrong admission outcome: %v", err)
			}
			for _, table := range []any{&model.Task{}, &model.BillingOrder{}} {
				var count int64
				if err := db.Model(table).Count(&count).Error; err != nil {
					t.Fatal(err)
				}
				if count != 0 {
					t.Fatalf("rejected request left %T rows: %d", table, count)
				}
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if account.AvailableMicrocredits != 1_000_000 || account.ReservedMicrocredits != 0 {
				t.Fatalf("rejected request altered credit account: %+v", account)
			}
		})
	}
}
