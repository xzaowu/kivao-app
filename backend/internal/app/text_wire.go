package app

import (
	"context"

	"yingce/backend/internal/protocol"
)

func declaredTextWire(ctx context.Context, id string) string {
	adapter, ok := protocolAdapterForContext(ctx, id)
	if !ok || !activeTextProtocol(adapter.Metadata()) {
		return ""
	}
	return adapter.Metadata().TextWire
}

func activeTextProtocol(metadata protocol.Metadata) bool {
	return metadata.Enabled && metadata.UnavailableReason == "" && containsPluginCapability(metadata.Categories, protocol.CapabilityText)
}

func (s *Service) textModelWire(id string) string {
	metadata, ok := s.protocolMetadata(id)
	if !ok || !activeTextProtocol(metadata) {
		return ""
	}
	return metadata.TextWire
}
