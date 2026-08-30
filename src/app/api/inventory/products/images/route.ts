import {
  deleteProductImage,
  uploadProductImage,
} from "@/lib/images/product-image-route";

export function POST(request: Request) {
  return uploadProductImage(request);
}

export function DELETE(request: Request) {
  return deleteProductImage(request);
}
