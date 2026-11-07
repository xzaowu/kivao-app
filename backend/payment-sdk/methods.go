package paymentsdk

import (
	"fmt"
	"strings"
)

type PaymentMethod struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Payment providers opt in through descriptor.paymentMethods; configuration stays versioned with the merchant credentials.
func AvailablePaymentMethods(descriptor Descriptor, config Config) ([]PaymentMethod, string, error) {
	if len(descriptor.PaymentMethods) == 0 {
		return nil, "", nil
	}
	defaultID := strings.TrimSpace(config["payType"])
	if defaultID == "" {
		defaultID = descriptor.PaymentMethods[0].ID
	}
	if len(defaultID) > 40 {
		return nil, "", fmt.Errorf("默认支付方式过长")
	}
	options := make(map[string]PaymentMethod, len(descriptor.PaymentMethods))
	for _, method := range descriptor.PaymentMethods {
		options[method.ID] = method
	}
	// Preserve gateway-specific defaults already supported by the previous single-method configuration.
	if _, ok := options[defaultID]; !ok {
		options[defaultID] = PaymentMethod{ID: defaultID, Label: defaultID}
	}
	configured := strings.TrimSpace(config["payTypes"])
	if configured == "" {
		method, ok := options[defaultID]
		if !ok {
			method = PaymentMethod{ID: defaultID, Label: defaultID}
		}
		return []PaymentMethod{method}, defaultID, nil
	}
	methods := make([]PaymentMethod, 0)
	seen := map[string]bool{}
	for _, raw := range strings.Split(configured, ",") {
		id := strings.TrimSpace(raw)
		method, ok := options[id]
		if !ok {
			return nil, "", fmt.Errorf("不支持的支付方式 %q", id)
		}
		if !seen[id] {
			methods = append(methods, method)
			seen[id] = true
		}
	}
	if !seen[defaultID] {
		return nil, "", fmt.Errorf("默认支付方式必须包含在开放的支付方式中")
	}
	return methods, defaultID, nil
}

func ResolvePaymentMethod(descriptor Descriptor, config Config, requested string) (string, error) {
	methods, defaultID, err := AvailablePaymentMethods(descriptor, config)
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(requested)
	if id == "" {
		return defaultID, nil
	}
	for _, method := range methods {
		if method.ID == id {
			return id, nil
		}
	}
	return "", fmt.Errorf("该支付方式未开放")
}
