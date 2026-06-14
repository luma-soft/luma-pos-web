import { z } from "zod";

/** Schema dùng chung client/server cho tạo đơn POS. */
export const orderItemSchema = z.object({
  productId: z.uuid(),
  productName: z.string().min(1),
  unitName: z.string().min(1),
  unitMultiplier: z.number().positive(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
});

export const createOrderSchema = z.object({
  mode: z.enum(["sale", "quote"]).default("sale"),
  // id sinh ở client để khử trùng khi đồng bộ offline (sync lại không tạo đơn trùng)
  clientId: z.string().max(40).optional(),
  customerId: z.uuid().nullable().optional(),
  warehouseId: z.uuid(),
  projectId: z.uuid().nullable().optional(),
  projectName: z.string().optional(),
  deliveryAddress: z.string().optional(),
  note: z.string().optional(),
  discount: z.number().min(0).default(0),
  shippingFee: z.number().min(0).default(0),
  items: z.array(orderItemSchema).min(1, { error: "pos.errors.emptyCart" }),
  payment: z.object({
    method: z.enum(["cash", "bank_transfer", "credit"]),
    amount: z.number().min(0),
  }),
});

export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type CreateOrderOutput = z.output<typeof createOrderSchema>;

// Sửa đơn
export const updateOrderSchema = z.object({
  orderId: z.uuid(),
  projectName: z.string().optional(),
  note: z.string().optional(),
  discount: z.number().min(0).default(0),
  shippingFee: z.number().min(0).default(0),
  items: z.array(orderItemSchema).min(1),
});
export type UpdateOrderInput = z.input<typeof updateOrderSchema>;
export type UpdateOrderOutput = z.output<typeof updateOrderSchema>;

// Gộp đơn
export const mergeOrdersSchema = z.object({
  orderIds: z.array(z.uuid()).min(2).max(20),
});
export type MergeOrdersInput = z.input<typeof mergeOrdersSchema>;

export const addPaymentSchema = z.object({
  orderId: z.uuid(),
  amount: z.number().positive(),
  method: z.enum(["cash", "bank_transfer", "card"]),
  note: z.string().optional(),
});
export type AddPaymentInput = z.infer<typeof addPaymentSchema>;

export const createCustomerSchema = z.object({
  name: z.string().min(1, { error: "validation.required" }),
  phone: z.string().optional(),
  address: z.string().optional(),
  type: z.enum(["retail", "wholesale", "contractor", "agent"]).default("retail"),
  taxCode: z.string().optional(),
  debtLimit: z.number().min(0).default(0),
  note: z.string().optional(),
});
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type CreateCustomerOutput = z.output<typeof createCustomerSchema>;

// Sửa khách hàng
export const updateCustomerSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, { error: "validation.required" }),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  address: z.string().trim().optional(),
  type: z.enum(["retail", "wholesale", "contractor", "agent"]),
  taxCode: z.string().trim().optional(),
  debtLimit: z.number().min(0).default(0),
  note: z.string().trim().optional(),
});
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;
export type UpdateCustomerOutput = z.output<typeof updateCustomerSchema>;

export const createSupplierSchema = z.object({
  name: z.string().min(1, { error: "validation.required" }),
  phone: z.string().optional(),
  address: z.string().optional(),
  taxCode: z.string().optional(),
  note: z.string().optional(),
});
export type CreateSupplierInput = z.input<typeof createSupplierSchema>;
export type CreateSupplierOutput = z.output<typeof createSupplierSchema>;

export const purchaseItemSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().positive(), // theo đơn vị gốc
  unitCost: z.number().min(0),
  discount: z.number().min(0).default(0), // giảm giá dòng (VND)
});

export const createPurchaseSchema = z.object({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  discount: z.number().min(0).default(0),   // giảm giá cả phiếu (VND)
  vatRate: z.number().min(0).max(100).default(0), // % VAT
  invoiceNumber: z.string().optional(),     // số hóa đơn đầu vào
  note: z.string().optional(),
  amountPaid: z.number().min(0).default(0),
  items: z.array(purchaseItemSchema).min(1, { error: "purchases.errors.emptyItems" }),
});
export type CreatePurchaseInput = z.input<typeof createPurchaseSchema>;
export type CreatePurchaseOutput = z.output<typeof createPurchaseSchema>;
