package app

import (
	"errors"
	"net/http"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func (s *Service) systemProxyProtocol(id model.ChannelInterfaceType) (protocol.Adapter, bool) {
	adapter, ok := s.protocolRegistry().Resolve(string(id))
	if !ok {
		return nil, false
	}
	metadata := adapter.Metadata()
	return adapter, metadata.Enabled && metadata.UnavailableReason == "" && containsPluginSurface(metadata.Scopes, protocol.SurfaceAdminSystemChannel)
}

// A raw browser proxy cannot execute plugin templates, change origins, or
// expand arbitrary endpoints. It admits only static declared POST operations;
// the handler still enforces its finite endpoint and model allowlists.
func (s *Service) SystemProxyDeclaredPostPaths(id model.ChannelInterfaceType) []string {
	adapter, ok := s.systemProxyProtocol(id)
	if !ok || adapter.Metadata().Execution != "declarative" {
		return nil
	}
	var paths []string
	for _, value := range protocol.StaticProxyPostPaths(adapter) {
		if prefix := requestAPIPathPrefix(value); prefix != "" {
			value = strings.TrimPrefix(value, prefix)
		}
		paths = append(paths, value)
	}
	return paths
}

func (s *Service) SystemProxyTextWire(id model.ChannelInterfaceType, requestPath string) string {
	adapter, ok := s.systemProxyProtocol(id)
	if !ok || !activeTextProtocol(adapter.Metadata()) {
		return ""
	}
	for _, allowed := range s.SystemProxyDeclaredPostPaths(id) {
		if allowed == requestPath {
			return protocol.TextWireForOperation("POST " + allowed)
		}
	}
	return ""
}

func (s *Service) ApplySystemProxyAuth(req *http.Request, channel *model.ModelChannel, id model.ChannelInterfaceType) error {
	config := providerConfig{APIKey: channel.APIKey, SecretKey: channel.SecretKey}
	if id == model.ChannelInterfaceClaudeAPI {
		config.APIFormat = "claude"
	} else if id == model.ChannelInterfaceGeminiVeo || id == model.ChannelInterfaceGeminiImage {
		config.APIFormat = "gemini"
	}
	if id == "" { // The channel's read-only /models lookup has no selected provider.
		applyProviderAuth(req, config)
		return nil
	}
	adapter, ok := s.systemProxyProtocol(id)
	if !ok {
		return errors.New("当前系统渠道协议未安装、未启用或不允许用于系统渠道")
	}
	return applyProtocolAuth(req, config, adapter.Metadata().Auth)
}
