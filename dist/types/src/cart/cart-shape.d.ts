export declare const CART: {
    readonly id: "string";
    readonly checkoutUrl: "string";
    readonly totalQuantity: "number";
    readonly attributes: readonly ["object"];
    readonly discountCodes: readonly ["object"];
    readonly cost: {
        readonly totalAmount: {
            readonly amount: "string";
            readonly currencyCode: "string";
        };
        readonly subtotalAmount: {
            readonly amount: "string";
            readonly currencyCode: "string";
        };
    };
    readonly lines: {
        readonly nodes: readonly [{
            readonly id: "string";
            readonly quantity: "number";
            readonly attributes: readonly ["object"];
            readonly cost: {
                readonly totalAmount: {
                    readonly amount: "string";
                    readonly currencyCode: "string";
                };
                readonly subtotalAmount: {
                    readonly amount: "string";
                    readonly currencyCode: "string";
                };
                readonly amountPerQuantity: {
                    readonly amount: "string";
                    readonly currencyCode: "string";
                };
            };
            readonly merchandise: {
                readonly id: "string";
                readonly selectedOptions: readonly ["object"];
                readonly product: "object";
            };
        }];
    };
};
