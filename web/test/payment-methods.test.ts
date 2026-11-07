import { expect, spyOn, test } from "bun:test";
import { createPaymentOrder } from "../src/services/api/payments";
import { http } from "../src/services/api/request";

test("payment choice is sent separately from the provider and bound to the same idempotency request", async () => {
    const post = spyOn(http, "post").mockResolvedValue({ order: { id: "fake" } });
    const input = { productId: "product", providerId: "epay", paymentMethod: "wxpay", idempotencyKey: "same-request" };
    try {
        await createPaymentOrder(input);
        expect(post.mock.calls[0]).toEqual(["/payments/orders", input]);
    } finally {
        post.mockRestore();
    }
});
