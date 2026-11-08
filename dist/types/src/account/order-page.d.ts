type OrderState = 'loading' | 'ready' | 'not-found' | 'error';
/** Every state but `ready`, which shows with the order. */
export declare function showOrderState(el: HTMLElement, state: Exclude<OrderState, 'ready'>): void;
/** Loads and renders the order `el` names. A failure is reported and shows the error state. */
export declare function renderOrder(el: HTMLElement): Promise<void>;
export {};
