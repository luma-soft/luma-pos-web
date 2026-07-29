export type LineDiscountMode = "vnd" | "pct";

export type LinePriceEditorState = {
  price: string;
  discount: string;
  discountMode: LineDiscountMode;
  free: boolean;
  restore?: {
    price: string;
    discount: string;
    discountMode: LineDiscountMode;
  };
};

export function createLinePriceEditorState(
  unitPrice: number,
  lineDiscount: number,
): LinePriceEditorState {
  return {
    price: String(unitPrice),
    discount: String(lineDiscount),
    discountMode: "vnd",
    free: unitPrice === 0,
  };
}

export function setLineFree(
  state: LinePriceEditorState,
  free: boolean,
): LinePriceEditorState {
  if (free === state.free) return state;
  if (free) {
    return {
      ...state,
      price: "0",
      discount: "0",
      free: true,
      restore: {
        price: state.price,
        discount: state.discount,
        discountMode: state.discountMode,
      },
    };
  }
  return {
    ...state,
    ...(state.restore ?? {}),
    free: false,
    restore: undefined,
  };
}

export function setLinePriceInput(
  state: LinePriceEditorState,
  price: string,
): LinePriceEditorState {
  const directZero = price.trim() !== "" && Number(price) === 0;
  if (directZero) return { ...setLineFree(state, true), price: "0" };
  if (state.free) return { ...setLineFree(state, false), price };
  return { ...state, price };
}

export function setLineDiscountInput(
  state: LinePriceEditorState,
  discount: string,
): LinePriceEditorState {
  if (state.free) return state;
  return { ...state, discount };
}

export function setLineDiscountMode(
  state: LinePriceEditorState,
  discountMode: LineDiscountMode,
): LinePriceEditorState {
  if (state.free) return state;
  return { ...state, discountMode };
}

export function resolveLinePriceEditor(state: LinePriceEditorState) {
  const unitPrice = state.free ? 0 : Math.max(0, Number(state.price) || 0);
  const discountInput = state.free ? 0 : Math.max(0, Number(state.discount) || 0);
  const lineDiscount = state.discountMode === "pct"
    ? Math.round((unitPrice * discountInput) / 100)
    : discountInput;
  return {
    unitPrice,
    lineDiscount,
    sellPrice: Math.max(0, unitPrice - lineDiscount),
  };
}
