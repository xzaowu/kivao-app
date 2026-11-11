package app

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"syscall"
)

func renderSaveFailureMessage(err error) string {
	step := "保存成片失败"
	var writeErr *resourceObjectWriteError
	if errors.As(err, &writeErr) {
		if writeErr.provider == "local" {
			step = "写入服务器本地存储失败"
		} else {
			step = "上传对象存储（OSS/S3）失败"
		}
	}
	reason := strings.TrimRight(renderFailureReasonWithFallback(err, "存储返回未分类的错误，请管理员检查存储配置及资源记录"), "。.")
	return "视频已合成，但" + step + "：" + reason + "。已有镜头无需重新生成；请处理保存问题后重试合成。"
}

func renderFailureReason(err error) string {
	return renderFailureReasonWithFallback(err, truncateRunes(redactUpstreamAddress(safeProviderLogError(err)), 300))
}

func renderFailureReasonWithFallback(err error, fallback string) string {
	var networkErr net.Error
	var pathErr *os.PathError
	var appErr *AppError
	switch {
	case err == nil:
		return "存储未返回有效的成片记录"
	case errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "":
		// 业务错误的文案本来就给用户看（如账号文件容量不足），比“未分类的存储错误”更能说明怎么处理。
		return strings.TrimSpace(appErr.Message)
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "传输连接意外中断（EOF），请检查服务器到存储服务的网络连接"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &networkErr) && networkErr.Timeout():
		return "请求超时，请检查网络连接及存储服务是否可用"
	case errors.Is(err, syscall.ENOSPC):
		return "服务器磁盘空间不足，请清理空间"
	case errors.Is(err, os.ErrPermission):
		return "文件访问权限不足，请检查存储目录权限"
	case errors.As(err, &pathErr):
		return renderFailureReasonWithFallback(pathErr.Err, fallback)
	case strings.Contains(strings.ToLower(err.Error()), "database is locked"):
		// SQLite 驱动的原文通常带错误码后缀，如 “database is locked (5) (SQLITE_BUSY)”。
		return "数据库正忙，请稍后重试"
	default:
		return fallback
	}
}
