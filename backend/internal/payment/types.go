package payment

import (
	"yingce/backend/internal/protocol"
	paymentsdk "yingce/backend/payment-sdk"
)

type Config = paymentsdk.Config
type Descriptor = paymentsdk.Descriptor
type PaymentMethod = paymentsdk.PaymentMethod
type NotificationResponse = paymentsdk.NotificationResponse
type CreateRequest = paymentsdk.CreateRequest
type Checkout = paymentsdk.Checkout
type QueryRequest = paymentsdk.QueryRequest
type CloseRequest = paymentsdk.CloseRequest
type Result = paymentsdk.Result
type Notification = paymentsdk.Notification
type BillRecord = paymentsdk.BillRecord
type Provider = paymentsdk.Provider
type ProviderError = paymentsdk.ProviderError

var (
	AvailablePaymentMethods = paymentsdk.AvailablePaymentMethods
	ResolvePaymentMethod    = paymentsdk.ResolvePaymentMethod
	ErrOrderNotFound        = paymentsdk.ErrOrderNotFound
	ErrOrderNotPaid         = paymentsdk.ErrOrderNotPaid
	ErrTradeBillNotFound    = paymentsdk.ErrTradeBillNotFound
)

func DescriptorFromManifest(manifest protocol.Manifest, provider protocol.ManifestPaymentProvider) Descriptor {
	methods := make([]PaymentMethod, 0, len(provider.PaymentMethods))
	for _, method := range provider.PaymentMethods {
		methods = append(methods, PaymentMethod{ID: method.ID, Label: method.Label})
	}
	return Descriptor{
		ID: provider.ID, PluginID: manifest.Metadata.ID, PluginVersion: manifest.Metadata.Version, Name: provider.Label,
		Icon: provider.Icon, CheckoutMode: provider.CheckoutMode,
		IdentityFields:      append([]string(nil), provider.IdentityFields...),
		PaymentMethods:      methods,
		NotificationSuccess: NotificationResponse{Status: provider.NotificationSuccess.Status, ContentType: provider.NotificationSuccess.ContentType, Body: provider.NotificationSuccess.Body},
		NotificationFailure: NotificationResponse{Status: provider.NotificationFailure.Status, ContentType: provider.NotificationFailure.ContentType, Body: provider.NotificationFailure.Body},
	}
}
