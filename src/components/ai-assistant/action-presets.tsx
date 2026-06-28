"use client";

import { PackagePlus, ReceiptText, ShoppingBag } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { AssistantActionPreset } from "./types";

type Translator = ReturnType<typeof useTranslations>;

export function getAssistantActionPresets(t: Translator): AssistantActionPreset[] {
  return [
    {
      id: "create_invoice",
      label: t("ai.actions.createInvoice.label"),
      sessionTitle: t("ai.actions.createInvoice.sessionTitle"),
      description: t("ai.actions.createInvoice.description"),
      emptyText: t("ai.actions.createInvoice.emptyText"),
      placeholder: t("ai.actions.createInvoice.placeholder"),
      promptPrefix: t("ai.actions.createInvoice.promptPrefix"),
      examples: [
        t("ai.actions.createInvoice.example1"),
        t("ai.actions.createInvoice.example2"),
      ],
      icon: ReceiptText,
      tone: "sale",
    },
    {
      id: "draft_purchase_order",
      label: t("ai.actions.draftPurchaseOrder.label"),
      sessionTitle: t("ai.actions.draftPurchaseOrder.sessionTitle"),
      description: t("ai.actions.draftPurchaseOrder.description"),
      emptyText: t("ai.actions.draftPurchaseOrder.emptyText"),
      placeholder: t("ai.actions.draftPurchaseOrder.placeholder"),
      promptPrefix: t("ai.actions.draftPurchaseOrder.promptPrefix"),
      examples: [
        t("ai.actions.draftPurchaseOrder.example1"),
        t("ai.actions.draftPurchaseOrder.example2"),
      ],
      icon: ShoppingBag,
      tone: "purchase",
    },
    {
      id: "create_inventory_inbound",
      label: t("ai.actions.createInventoryInbound.label"),
      sessionTitle: t("ai.actions.createInventoryInbound.sessionTitle"),
      description: t("ai.actions.createInventoryInbound.description"),
      emptyText: t("ai.actions.createInventoryInbound.emptyText"),
      placeholder: t("ai.actions.createInventoryInbound.placeholder"),
      promptPrefix: t("ai.actions.createInventoryInbound.promptPrefix"),
      examples: [
        t("ai.actions.createInventoryInbound.example1"),
        t("ai.actions.createInventoryInbound.example2"),
      ],
      icon: PackagePlus,
      tone: "inbound",
    },
    {
      id: "receive_stock",
      label: t("ai.actions.receiveStock.label"),
      sessionTitle: t("ai.actions.receiveStock.sessionTitle"),
      description: t("ai.actions.receiveStock.description"),
      emptyText: t("ai.actions.receiveStock.emptyText"),
      placeholder: t("ai.actions.receiveStock.placeholder"),
      promptPrefix: t("ai.actions.receiveStock.promptPrefix"),
      examples: [
        t("ai.actions.receiveStock.example1"),
        t("ai.actions.receiveStock.example2"),
      ],
      icon: PackagePlus,
      tone: "inbound",
    },
  ];
}
