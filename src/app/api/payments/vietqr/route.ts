import bwipjs from "bwip-js/node";
import { NextResponse } from "next/server";
import { buildVietQrPayload } from "@/lib/payments/vietqr";

/**
 * Public VietQR image for POS checkout, receipts and mobile clients.
 * The QR only encodes what is already printed beside it (bank, account,
 * amount, transfer content), so it needs no session.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const amountParam = params.get("amount");
  const amount = amountParam ? Number(amountParam) : undefined;
  const payload = buildVietQrPayload({
    bankCode: params.get("bank") ?? "",
    accountNumber: params.get("acc") ?? "",
    amount: amount != null && Number.isFinite(amount) ? amount : undefined,
    reference: params.get("des") ?? undefined,
  });
  if (!payload) {
    return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
  }

  // `eclevel` is a valid BWIPP qrcode option that the bundled typings omit.
  const options = {
    bcid: "qrcode",
    text: payload,
    eclevel: "M",
    scale: 8,
    paddingwidth: 4,
    paddingheight: 4,
    backgroundcolor: "FFFFFF",
  } as bwipjs.RenderOptions;
  const png: Buffer = await bwipjs.toBuffer(options);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
