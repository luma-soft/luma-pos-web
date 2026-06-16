import { z } from "zod";

/** Tùy chọn đã chọn trên 1 dòng món (vd: "Ít đường", "Thêm trân châu +5k"). */
export const cartModifierSchema = z.object({
  label: z.string().min(1),
  priceDelta: z.number(),
});
export type CartModifier = z.infer<typeof cartModifierSchema>;

/** Dòng món trong giỏ của bàn (giàu hơn orderItem: có lineId, modifier, ghi chú, cờ gửi bếp). */
export const tableCartItemSchema = z.object({
  lineId: z.string().min(1),
  productId: z.uuid(),
  productName: z.string().min(1),
  unitName: z.string().min(1),
  unitMultiplier: z.number().positive(),
  quantity: z.number().positive(),
  basePrice: z.number().min(0),
  unitPrice: z.number().min(0), // basePrice + Σ modifier.priceDelta
  modifiers: z.array(cartModifierSchema).default([]),
  note: z.string().optional(),
  sent: z.boolean().default(false), // đã gửi bếp?
});
export type TableCartItemInput = z.input<typeof tableCartItemSchema>;
export type TableCartItem = z.output<typeof tableCartItemSchema>;

export const tableCartSchema = z.array(tableCartItemSchema);

/** Định nghĩa nhóm tùy chọn (quản lý trong trang Bàn). */
export const modifierOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  priceDelta: z.number().default(0),
});

export const modifierGroupSchema = z.object({
  name: z.string().trim().min(1, { error: "validation.required" }),
  multi: z.boolean().default(false),
  required: z.boolean().default(false),
  options: z.array(modifierOptionSchema).min(1),
  categoryIds: z.array(z.uuid()).default([]),
  sortOrder: z.number().int().default(0),
});
export type ModifierGroupInput = z.input<typeof modifierGroupSchema>;
