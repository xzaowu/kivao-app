package app

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"yingce/backend/internal/model"
)

func ecommerceClientOperationID(value string) string {
	if len(value) != 36 || uuid.Validate(value) != nil {
		return ""
	}
	return value
}

// Only these tested create templates send every ordered image for reference_to_video.
// A protocol with a known numbering layout can still send only its first image.
func supportsEcommerceReferenceImages(interfaceType string, profile *VideoCapabilityConfig) bool {
	if profile == nil || profile.References.MaxImages < 1 || !containsCapabilityString(profile.Operations, "reference_to_video") {
		return false
	}
	switch interfaceType {
	case string(model.ChannelInterfaceVolcengineArkVideo), "volcengine-ark-seedance-25", "seedance-videos-compatible",
		string(model.ChannelInterfaceMiniMaxVideo), "metaso-h3":
		return true
	}
	return false
}

// These create templates send the product image and reference clip together. Only some
// map the native audio switch too. The administrator's model limits still apply.
func ecommerceRemixCapabilities(interfaceType string, profile *VideoCapabilityConfig) (references, audio bool) {
	if profile == nil || profile.References.MinImages > 1 || profile.References.MaxImages < 1 || profile.References.MaxVideos < 1 ||
		!videoDurationSupported(profile) || !videoDurationAllowed(profile.Duration, 15) || !containsCapabilityString(profile.Operations, "reference_to_video") {
		return false, false
	}
	switch model.ChannelInterfaceType(interfaceType) {
	case model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineArkAgentPlanVideo, "volcengine-ark-seedance-25", model.ChannelInterfaceMiniMaxVideo, model.ChannelInterfaceNewAPIChannel2, "km-kemei-video":
		return true, profile.GenerateAudio.Supported
	case "seedance-videos-compatible", "metaso-h3", model.ChannelInterfaceNewAPIChannel1, "lxmone-seedance-videos":
		return true, false
	}
	return false, false
}

type ecommerceVideoModes struct {
	presenter, imageReferences, remix, audio bool
}

// Admission holds the checked struct; the worker and fallback routes read its JSON projection.
func ecommerceVideoInputModes(metadata map[string]any) ecommerceVideoModes {
	if metadata["source"] != "ecommerce-agent" || metadata["stage"] != "product-video" {
		return ecommerceVideoModes{}
	}
	switch version := metadata["ecommerceVideoVersion"].(type) {
	case *model.EcommerceVideoVersion:
		if version != nil {
			return ecommerceVideoModes{
				presenter: version.Presenter != nil, imageReferences: version.ProductImages != nil || version.BoardInputs,
				remix: version.ReferenceVideo != nil, audio: version.Settings.GenerateAudio || strings.TrimSpace(version.Voice) != "",
			}
		}
	case map[string]any:
		settings, _ := version["settings"].(map[string]any)
		return ecommerceVideoModes{
			presenter: version["presenter"] != nil, imageReferences: version["productImages"] != nil || version["boardInputs"] == true,
			remix: version["referenceVideo"] != nil, audio: settings["generateAudio"] == true || strings.TrimSpace(stringValue(version["voice"])) != "",
		}
	}
	return ecommerceVideoModes{}
}

// Product views keep their order. A board can reuse any of them without another model input.
func ecommerceVideoImageIDs(version *model.EcommerceVideoVersion) []string {
	ids := []string{version.Frame.ResourceID}
	for _, image := range version.ProductImages {
		if image.ResourceID != version.Frame.ResourceID {
			ids = append(ids, image.ResourceID)
		}
	}
	for _, board := range version.Boards {
		if board.Frame != nil && !slices.Contains(ids, board.Frame.ResourceID) {
			ids = append(ids, board.Frame.ResourceID)
		}
	}
	return ids
}

func decodeEcommerceVideoVersion(raw []byte, firstFrame, operation string) *model.EcommerceVideoVersion {
	var v model.EcommerceVideoVersion
	if len(raw) == 0 || json.Unmarshal(raw, &v) != nil || v.Schema != 1 || v.Settings.Seconds != 15 || len(v.Shots) != 3 {
		return nil
	}
	validID := func(id string) bool { return id != "" && validCanvasResourceID(id) == id }
	if !validID(v.Frame.ResourceID) || (v.ParentTaskID != "" && !validID(v.ParentTaskID)) || (v.ApproachID != "" && !validID(v.ApproachID)) {
		return nil
	}
	if v.Boards != nil && len(v.Boards) != len(v.Shots) {
		return nil
	}
	for _, board := range v.Boards {
		if board == nil || (board.Frame != nil && (!validID(board.Frame.ResourceID) || utf8.RuneCountInString(board.Frame.Name) > 512)) {
			return nil
		}
		switch board.Framing {
		case "", "wide", "medium", "close", "detail":
		default:
			return nil
		}
		switch board.Camera {
		case "", "static", "push", "pan", "follow":
		default:
			return nil
		}
	}
	if brief := v.ShootBrief; brief != nil && (utf8.RuneCountInString(brief.Scene) > 240 || utf8.RuneCountInString(brief.Closing) > 240) {
		return nil
	}
	if presenter := v.Presenter; presenter != nil {
		if v.ReferenceVideo != nil || operation != "image_to_video" || presenter.FrameResourceID != v.Frame.ResourceID || !v.Settings.GenerateAudio || strings.TrimSpace(v.Voice) == "" ||
			(presenter.Delivery != "recommend" && presenter.Delivery != "demonstrate" && presenter.Delivery != "answer") {
			return nil
		}
	}
	if v.ProductImages != nil || v.BoardInputs {
		if v.ReferenceVideo != nil || v.Presenter != nil || firstFrame != "" || operation != "reference_to_video" {
			return nil
		}
		if v.ProductImages != nil {
			if len(v.ProductImages) < 1 || len(v.ProductImages) > 3 || v.Frame.ResourceID != v.ProductImages[0].ResourceID {
				return nil
			}
			seen := map[string]bool{}
			for _, image := range v.ProductImages {
				if !validID(image.ResourceID) || seen[image.ResourceID] || utf8.RuneCountInString(image.Name) > 512 {
					return nil
				}
				seen[image.ResourceID] = true
			}
			v.Frame = v.ProductImages[0]
			if v.BoardInputs && !slices.ContainsFunc(v.Boards, func(b *model.EcommerceVideoBoardShot) bool { return b.Frame != nil }) {
				return nil
			}
		} else if len(ecommerceVideoImageIDs(&v)) < 2 {
			return nil
		}
	} else if ref := v.ReferenceVideo; ref != nil {
		if firstFrame != "" || operation != "reference_to_video" || !validID(ref.ResourceID) || ref.ResourceID == v.Frame.ResourceID || ref.DurationMs <= 0 || ref.DurationMs > maxQuoteReferenceVideoMillis || utf8.RuneCountInString(ref.Name) > 512 || utf8.RuneCountInString(ref.Instruction) > 240 {
			return nil
		}
		if ref.Aspects != nil {
			if len(ref.Aspects) == 0 || len(ref.Aspects) > 3 {
				return nil
			}
			seen := map[string]bool{}
			for _, aspect := range ref.Aspects {
				if (aspect != "rhythm" && aspect != "camera" && aspect != "framing") || seen[aspect] {
					return nil
				}
				seen[aspect] = true
			}
		}
	} else if v.Frame.ResourceID != firstFrame || (operation != "" && operation != "image_to_video") {
		return nil
	}
	if v.Purpose != "showcase" && v.Purpose != "lifestyle" && v.Purpose != "demo" {
		return nil
	}
	if strings.TrimSpace(v.Model) == "" || strings.TrimSpace(v.Settings.Ratio) == "" || strings.TrimSpace(v.Settings.Resolution) == "" {
		return nil
	}
	if utf8.RuneCountInString(v.Facts) > 16000 || utf8.RuneCountInString(v.Voice) > 16000 || utf8.RuneCountInString(v.ProductName) > 4000 || utf8.RuneCountInString(v.Audience) > 4000 ||
		utf8.RuneCountInString(v.Frame.Name) > 512 || utf8.RuneCountInString(v.Model) > 512 || utf8.RuneCountInString(v.Language) > 40 || utf8.RuneCountInString(v.Region) > 80 || utf8.RuneCountInString(v.Settings.Ratio) > 40 || utf8.RuneCountInString(v.Settings.Resolution) > 40 {
		return nil
	}
	for _, shot := range v.Shots {
		if strings.TrimSpace(shot) == "" || utf8.RuneCountInString(shot) > 16000 {
			return nil
		}
	}
	return &v
}

func (s *Service) prepareEcommerceVideoVersion(userID string, req CreateTaskRequest, input map[string]any) error {
	metadata, _ := input["metadata"].(map[string]any)
	raw, supplied := metadata["ecommerceVideoVersion"]
	if !supplied {
		if metadata["source"] == "ecommerce-agent" && metadata["stage"] == "product-video" && req.Operation == "reference_to_video" {
			return BadAuthRequest("参考生成缺少商品视频脚本")
		}
		return nil
	}
	if req.Type != "canvas_video" || input["mode"] != "video" || metadata["source"] != "ecommerce-agent" || metadata["stage"] != "product-video" || req.ProjectID == "" || metadata["ecommerceProjectId"] != req.ProjectID {
		return BadAuthRequest("视频脚本必须关联当前商品视频任务")
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return BadAuthRequest("商品视频脚本格式无效")
	}
	version := decodeEcommerceVideoVersion(encoded, stringValue(metadata["videoStartFrameNodeId"]), stringValue(metadata["videoEditOperation"]))
	if version == nil || version.Model != req.Model {
		return BadAuthRequest("商品视频脚本或拍摄设置无效")
	}
	config, _ := input["config"].(map[string]any)
	seconds, _ := workbenchInteger(config["videoSeconds"], 3600)
	audio, _ := workbenchBoolean(config["videoGenerateAudio"])
	if seconds != version.Settings.Seconds || audio != version.Settings.GenerateAudio {
		return BadAuthRequest("脚本的时长或音频设置与视频任务不一致")
	}
	if version.ReferenceVideo != nil && strings.TrimSpace(version.Voice) != "" && !audio {
		return BadAuthRequest("复刻台词需要支持同步音频的模型，请更换模型或清空台词")
	}
	// An unsupported ratio or resolution is omitted on the wire; record that
	// the provider decides it instead of displaying an unsubmitted preference.
	version.Settings.Ratio = defaultString(stringValue(config["size"]), "auto")
	version.Settings.Resolution = defaultString(stringValue(config["vquality"]), "auto")
	if utf8.RuneCountInString(version.Settings.Ratio) > 40 || utf8.RuneCountInString(version.Settings.Resolution) > 40 {
		return BadAuthRequest("商品视频输出规格无效")
	}
	images, _ := input["referenceImages"].([]any)
	imageIDs := ecommerceVideoImageIDs(version)
	usesReferences := version.ProductImages != nil || version.BoardInputs
	inputCount := max(1, len(version.ProductImages))
	if version.BoardInputs {
		inputCount = len(imageIDs)
	}
	if len(images) != inputCount {
		return BadAuthRequest("商品视频的参考图数量与脚本不一致")
	}
	for index, id := range imageIDs {
		if index >= inputCount {
			// Older versions and other video modes retain these images only in their planning snapshot.
			if _, err := s.ownedEcommerceVideoResource(userID, id, "image"); err != nil {
				return err
			}
			continue
		}
		media, _ := images[index].(map[string]any)
		if (usesReferences || version.Frame.Source != "") && media["id"] != id {
			return BadAuthRequest("脚本与生成使用的参考图不一致")
		}
		if usesReferences && media["role"] != "reference" {
			return BadAuthRequest("带货视频的商品图与分镜图均需作为参考图")
		}
		if _, err := s.ecommerceVideoInputResource(userID, media, id, "image"); err != nil {
			return err
		}
	}
	image, _ := images[0].(map[string]any)
	videos, _ := input["referenceVideos"].([]any)
	audios, _ := input["referenceAudios"].([]any)
	if len(audios) > 0 {
		return BadAuthRequest("商品视频脚本没有声音素材")
	}
	if usesReferences || version.ReferenceVideo != nil || version.Presenter != nil {
		if !taskInputUsesSystemChannel(input) && (req.LogicalModelID == "" || taskInputUsesCustomChannel(input) || taskInputUsesWorkflowProvider(input)) {
			return InvalidModelSelection("请选择可报价的系统视频模型")
		}
	}
	if usesReferences {
		if req.Operation != "reference_to_video" || len(videos) > 0 || input["mask"] != nil || stringValue(metadata["videoEndFrameNodeId"]) != "" {
			return BadAuthRequest("带货视频只接受商品图与分镜参考图")
		}
		prompt := strings.TrimSpace(req.Prompt)
		if inputPrompt := stringValue(input["prompt"]); inputPrompt != "" && strings.TrimSpace(inputPrompt) != prompt {
			return BadAuthRequest("带货视频脚本与生成提示词不一致")
		}
		labels := dramaPromptReferenceLabels(prompt)
		if len(labels) != inputCount {
			return BadAuthRequest("带货视频脚本需要对应每一张参考图")
		}
		bindings := make([]dramaReferenceBinding, inputCount)
		for i, id := range imageIDs[:inputCount] {
			label := fmt.Sprintf("参考图%d", i+1)
			if !slices.Contains(labels, label) {
				return BadAuthRequest("带货视频脚本中的参考图编号无效")
			}
			bindings[i] = dramaReferenceBinding{Label: label, MediaID: id}
		}
		// The same wire compiler verifies every bound image in the adapter's final create request.
		metadata[dramaReferenceBindingsKey] = bindings
	} else if ref := version.ReferenceVideo; ref != nil {
		if req.Operation != "reference_to_video" || image["role"] != "reference" || len(videos) != 1 || stringValue(metadata["videoEndFrameNodeId"]) != "" {
			return BadAuthRequest("参考复刻需要一张商品参考图和一段参考视频")
		}
		video, _ := videos[0].(map[string]any)
		duration, _ := workbenchInteger(video["durationMs"], int(maxQuoteReferenceVideoMillis))
		if int64(duration) != ref.DurationMs || (stringValue(video["role"]) != "" && video["role"] != "reference") {
			return BadAuthRequest("脚本与生成使用的参考视频不一致")
		}
		resource, err := s.ecommerceVideoInputResource(userID, video, ref.ResourceID, "video")
		if err != nil {
			return err
		}
		if resource.DurationMs != ref.DurationMs {
			return BadAuthRequest("参考视频时长已变化，请重新选择并核对报价")
		}
	} else if req.Operation != "image_to_video" || image["role"] != "first_frame" || len(videos) > 0 {
		return BadAuthRequest("脚本首帧与生成输入不一致")
	}
	if presenter := version.Presenter; presenter != nil {
		if image["id"] != presenter.FrameResourceID || stringValue(metadata["videoEndFrameNodeId"]) != "" || input["mask"] != nil {
			return BadAuthRequest("人物口播需要使用已确认的人物与商品同框首帧")
		}
		prompt := strings.TrimSpace(req.Prompt)
		if inputPrompt := stringValue(input["prompt"]); (inputPrompt != "" && inputPrompt != prompt) || !strings.Contains(prompt, strings.TrimSpace(version.Voice)) {
			return BadAuthRequest("人物口播台词与生成任务不一致")
		}
	}
	if version.ParentTaskID != "" {
		parent, err := s.repo.TaskForUser(userID, version.ParentTaskID)
		if err != nil || parent.ProjectID != req.ProjectID || parent.Type != "canvas_video" {
			return BadAuthRequest("原版本不属于当前商品项目")
		}
		context, _ := taskOutputContext(*parent)
		if context == nil || context.EcommerceVideoVersion == nil {
			return BadAuthRequest("原版本缺少可复用的商品视频脚本")
		}
	}
	metadata["ecommerceVideoVersion"] = version
	return nil
}

// Quote and order use the same group-adjusted microcredits, including reference charges.
func applyEcommerceVideoQuote(input map[string]any, task *model.Task, order *model.BillingOrder) error {
	metadata, _ := input["metadata"].(map[string]any)
	version, _ := metadata["ecommerceVideoVersion"].(*model.EcommerceVideoVersion)
	videoImage := ecommerceVideoImageStage(metadata["stage"])
	imageReferences := version != nil && (version.ProductImages != nil || version.BoardInputs)
	if !videoImage && (version == nil || (!imageReferences && version.ReferenceVideo == nil && version.Presenter == nil)) {
		return nil
	}
	if version != nil && (version.Presenter != nil || imageReferences || version.ReferenceVideo != nil) {
		config, _ := input["config"].(map[string]any)
		if imageReferences || version.ReferenceVideo != nil {
			seconds, _ := workbenchInteger(config["videoSeconds"], 3600)
			audio, _ := workbenchBoolean(config["videoGenerateAudio"])
			if seconds != version.Settings.Seconds || audio != version.Settings.GenerateAudio {
				return BadAuthRequest("商品视频的实际时长或音频设置与分镜不一致，请重新核对")
			}
		}
		version.Settings.Ratio = defaultString(stringValue(config["size"]), "auto")
		version.Settings.Resolution = defaultString(stringValue(config["vquality"]), "auto")
	}
	quote, _ := metadata["ecommerceVideoQuote"].(map[string]any)
	mode, _ := quote["billingMode"].(string)
	amount, ok := quote["amountMicrocredits"].(float64) // normalizeTaskInput decoded JSON numbers.
	if !ok || amount < 0 || amount > 1<<53-1 || math.Trunc(amount) != amount || (mode != "fixed_request" && mode != "token" && !(mode == "per_second" && !videoImage) && !(mode == "image_usage" && videoImage)) {
		return BadAuthRequest("商品视频缺少有效的确认报价，请重新获取报价")
	}
	metadata["ecommerceVideoQuote"] = map[string]any{"billingMode": mode, "amountMicrocredits": int64(amount)}
	// With site credits disabled, managed models create no order or reservation.
	if order == nil {
		return nil
	}
	capped := videoImage || mode != "token"
	if mode != order.BillingMode || (capped && order.AmountMicrocredits > int64(amount)) {
		return BadAuthRequest("商品视频的计费方式或费用已变化，尚未提交任务，请重新核对报价")
	}
	if capped {
		order.ChargeLimitSet = true
		order.ChargeLimitMicrocredits = int64(amount)
		task.AuthorizedChargeMicrocredits = int64(amount)
	}
	return nil
}

func (s *Service) ecommerceVideoInputResource(userID string, media map[string]any, id, kind string) (*model.Resource, error) {
	if media["storageKey"] != "resource:"+id || stringValue(media["url"]) != "" || stringValue(media["fileUrl"]) != "" || stringValue(media["dataUrl"]) != "" || stringValue(media["sourceResourceId"]) != "" {
		return nil, BadAuthRequest("商品视频素材与脚本不一致，请重新选择")
	}
	resource, err := s.ownedEcommerceVideoResource(userID, id, kind)
	if err != nil {
		return nil, err
	}
	media["type"], media["mimeType"], media["bytes"] = resource.MimeType, resource.MimeType, resource.Size
	media["width"], media["height"] = resource.Width, resource.Height
	return resource, nil
}

func (s *Service) ownedEcommerceVideoResource(userID, id, kind string) (*model.Resource, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil || resource.Status != model.ResourceStatusReady || resource.Kind != kind || !strings.HasPrefix(resource.MimeType, kind+"/") {
		return nil, BadAuthRequest("商品视频素材不可用，请重新选择")
	}
	return resource, nil
}
