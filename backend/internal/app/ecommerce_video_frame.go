package app

const (
	ecommerceVideoFrameStage   = "product-video-frame"
	ecommerceVideoCastingStage = "product-video-casting"
)

func ecommerceVideoImageStage(stage any) bool {
	return stage == ecommerceVideoFrameStage || stage == ecommerceVideoCastingStage
}

func (s *Service) prepareProductVideoImage(userID string, req CreateTaskRequest, input map[string]any) error {
	metadata, _ := input["metadata"].(map[string]any)
	if !ecommerceVideoImageStage(metadata["stage"]) {
		return nil
	}
	casting := metadata["stage"] == ecommerceVideoCastingStage
	if ecommerceClientOperationID(stringValue(metadata["clientOperationId"])) == "" {
		return BadAuthRequest("出镜图片任务缺少提交回执编号")
	}
	if taskInputUsesCustomChannel(input) || taskInputUsesWorkflowProvider(input) || (!taskInputUsesSystemChannel(input) && req.LogicalModelID == "") {
		if casting {
			return InvalidModelSelection("生成模特需要支持文生图的系统图片模型")
		}
		return InvalidModelSelection("同框图需要支持双图编辑的系统图片模型")
	}
	intent := ModelRequestIntentFromTaskInput(input, req.Type, req.Operation)
	images, _ := input["referenceImages"].([]any)
	config, _ := input["config"].(map[string]any)
	parameters, _ := config["imageParameters"].(map[string]any)
	for _, options := range []map[string]any{config, parameters, intent.Options} {
		if raw := options["count"]; raw != nil {
			if count, ok := workbenchInteger(raw, 1); !ok || count != 1 {
				return BadAuthRequest("每次只能生成一张出镜图片")
			}
		}
		if enabled, _ := workbenchBoolean(options["layerDecomposition"]); enabled {
			return BadAuthRequest("出镜图片不支持图层拆分")
		}
	}
	if casting {
		for _, key := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
			if raw := input[key]; raw != nil {
				if refs, ok := raw.([]any); !ok || len(refs) != 0 {
					return BadAuthRequest("生成模特只接受文字描述，请移除参考素材")
				}
			}
		}
		if input["mask"] != nil {
			return BadAuthRequest("生成模特只接受文字描述，请移除蒙版")
		}
		return nil
	}
	if len(images) != 2 || intent.Inputs["video"] > 0 || intent.Inputs["audio"] > 0 || input["mask"] != nil {
		return BadAuthRequest("请各选择一张人物图和商品图")
	}
	var personID string
	for index, key := range []string{"person", "product"} {
		image, _ := images[index].(map[string]any)
		id := stringValue(image["id"])
		if id == "" || id == personID || image["slotKey"] != key || image["role"] != "reference" {
			return BadAuthRequest("请分别指定人物原图和商品原图")
		}
		if _, err := s.ecommerceVideoInputResource(userID, image, id, "image"); err != nil {
			return err
		}
		personID = id
	}
	return nil
}
