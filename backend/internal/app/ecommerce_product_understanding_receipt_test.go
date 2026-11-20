package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceVideoClaimsProductImages(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled, features.VideoWorkbenchEnabled = true, true, true
	saveAdmissionFeatures(t, s, features)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "third", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/jpeg", Size: 64}).Error; err != nil {
		t.Fatal(err)
	}
	input := func(ids ...string) map[string]any {
		refs := []any{}
		for _, id := range ids {
			refs = append(refs, map[string]any{"id": id, "storageKey": "resource:" + id})
		}
		return map[string]any{"mode": "text", "referenceImages": refs, "metadata": map[string]any{"source": "ecommerce-agent", "stage": "product-understanding", "productVideoClaims": true, "ecommerceProjectId": project.ID}}
	}
	for _, tc := range []struct {
		ids   []string
		valid bool
	}{
		{[]string{"ref-one"}, true}, {[]string{"ref-one", "ref-two", "third"}, true}, {nil, false}, {[]string{"ref-one", "ref-one"}, false}, {[]string{"ref-one", "private"}, false}, {[]string{"ref-one", "ref-two", "third", "fourth"}, false},
	} {
		task := input(tc.ids...)
		if _, err := s.prepareEcommerceWorkbenchTask("user", task, "分析商品"); (err == nil) != tc.valid {
			t.Fatalf("claim images %v, err=%v", tc.ids, err)
		}
		if tc.valid {
			for index, raw := range task["referenceImages"].([]any) {
				ref := raw.(map[string]any)
				if ref["id"] != tc.ids[index] || ref["mimeType"] == "" || ref["mimeType"] == nil {
					t.Fatal("source metadata missing or order changed")
				}
			}
		}
	}
	task := input("ref-one")
	if err := s.requireTaskGenerationFeatures("user", "other", "canvas_text", "", "", task); err == nil {
		t.Fatal("accepted image analysis for a different project")
	}
	if err := s.requireTaskGenerationFeatures("user", project.ID, "canvas_text", "", "", task); err != nil {
		t.Fatal(err)
	}
	task["referenceImages"].([]any)[0].(map[string]any)["url"] = "https://media.example/fake"
	if _, err := s.prepareEcommerceWorkbenchTask("user", task, "分析商品"); err == nil {
		t.Fatal("accepted alternate URL")
	}
}

func TestEcommerceProductUnderstandingReceipt(t *testing.T) {
	const operation = "4e7599dc-6082-48de-94ab-7469885f2ba6"
	for _, tc := range []struct{ name, source, stage, taskType, mode, project, metadataProject, id, want string }{
		{"analysis", "ecommerce-agent", "product-understanding", "canvas_text", "text", "a", "a", operation, operation},
		{"image workbench analysis without receipt", "ecommerce-agent", "product-understanding", "canvas_text", "text", "a", "a", "", ""},
		{"unrelated source", "other", "product-understanding", "canvas_text", "text", "a", "a", operation, ""},
		{"unrelated stage", "ecommerce-agent", "planning", "canvas_text", "text", "a", "a", operation, ""},
		{"foreign project", "ecommerce-agent", "product-understanding", "canvas_text", "text", "a", "b", operation, ""},
		{"no project", "ecommerce-agent", "product-understanding", "canvas_text", "text", "", "", operation, ""},
		{"image task", "ecommerce-agent", "product-understanding", "canvas_image", "text", "a", "a", operation, ""},
		{"image mode", "ecommerce-agent", "product-understanding", "canvas_text", "image", "a", "a", operation, ""},
		{"malformed", "ecommerce-agent", "product-understanding", "canvas_text", "text", "a", "a", "not-a-receipt", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := map[string]any{"source": tc.source, "stage": tc.stage, "ecommerceProjectId": tc.metadataProject, "nodeId": "node", "shotId": "shot", "workflowStepId": "step", "artifactType": "draft"}
			if tc.id != "" {
				m["clientOperationId"] = tc.id
			}
			payload, err := json.Marshal(map[string]any{"mode": tc.mode, "metadata": m, "referenceImages": []any{map[string]any{"storageKey": "resource:test"}}})
			if err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "task", Type: tc.taskType, ProjectID: tc.project, InputJSON: string(payload)}
			for _, raw := range []string{task.InputJSON, compactTaskHistoryInput(task)} {
				task.InputJSON = raw
				detail := taskForOutput(task)
				summary := taskSummaryForOutput(task)
				if detail.ClientOperationID != tc.want || summary.ClientOperationID != tc.want {
					t.Fatal("unexpected detail or list receipt")
				}
				if c := summary.ClientContext; c == nil || c.NodeID != "node" || c.ShotID != "shot" || c.WorkflowStepID != "step" {
					t.Fatal("lost existing task context")
				}
				if tc.want != "" && (detail.ClientContext == nil || detail.ClientContext.ShotID != "shot") {
					t.Fatal("receipt discarded existing task context")
				}
				var public struct {
					Metadata map[string]any `json:"metadata"`
				}
				if err := json.Unmarshal([]byte(detail.InputJSON), &public); err != nil || public.Metadata["artifactType"] != "draft" {
					t.Fatal("lost original analysis metadata")
				}
			}
		})
	}

	t.Run("completed text without a node remains recoverable in project history", func(t *testing.T) {
		s, db, _ := agentMediaFixture(t)
		features := defaultFeatureAvailability()
		features.EcommerceEnabled = true
		saveAdmissionFeatures(t, s, features)
		project, err := s.CreateEcommerceProject("user")
		if err != nil {
			t.Fatal(err)
		}
		payload, err := json.Marshal(map[string]any{"mode": "text", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "product-understanding", "ecommerceProjectId": project.ID, "clientOperationId": operation}})
		if err != nil {
			t.Fatal(err)
		}
		task := model.Task{ID: "analysis", UserID: "user", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: string(payload)}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		if err := s.saveTaskCompletionWithinStorageQuota(&task, []byte(`{"text":"商品有圆形轮廓"}`), nil, false); err != nil {
			t.Fatal(err)
		}
		read, err := s.Task("user", task.ID)
		if err != nil || read.Status != model.TaskStatusSucceeded || read.ClientOperationID != operation {
			t.Fatalf("completed detail unavailable: %v", err)
		}
		list, err := s.TasksWithOptions("user", TaskListOptions{ProjectID: project.ID})
		if err != nil || len(list) != 1 || list[0].ClientOperationID != operation {
			t.Fatalf("completed task missing from project list: %v", err)
		}
		if _, err := s.Task("other", task.ID); err == nil {
			t.Fatal("foreign task visible")
		}
	})
}
