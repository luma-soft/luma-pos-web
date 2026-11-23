/** Banks supported by the store bank-account picker and the VietQR generator (NAPAS BIN per bank code). */
export const VIETQR_BANKS = [
  { code: "ICB", bin: "970415", shortName: "VietinBank", name: "Ngân hàng TMCP Công thương Việt Nam", logo: "https://api.vietqr.io/img/ICB.png", aliases: [] },
  { code: "VCB", bin: "970436", shortName: "Vietcombank", name: "Ngân hàng TMCP Ngoại Thương Việt Nam", logo: "https://api.vietqr.io/img/VCB.png", aliases: [] },
  { code: "MB", bin: "970422", shortName: "MBBank", name: "Ngân hàng TMCP Quân đội", logo: "https://api.vietqr.io/img/MB.png", aliases: [] },
  { code: "ACB", bin: "970416", shortName: "ACB", name: "Ngân hàng TMCP Á Châu", logo: "https://api.vietqr.io/img/ACB.png", aliases: [] },
  { code: "VPB", bin: "970432", shortName: "VPBank", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng", logo: "https://api.vietqr.io/img/VPB.png", aliases: [] },
  { code: "TPB", bin: "970423", shortName: "TPBank", name: "Ngân hàng TMCP Tiên Phong", logo: "https://api.vietqr.io/img/TPB.png", aliases: [] },
  { code: "MSB", bin: "970426", shortName: "MSB", name: "Ngân hàng TMCP Hàng Hải Việt Nam", logo: "https://api.vietqr.io/img/MSB.png", aliases: [] },
  { code: "LPB", bin: "970449", shortName: "LienVietPostBank", name: "Ngân hàng TMCP Lộc Phát Việt Nam", logo: "https://api.vietqr.io/img/LPB.png", aliases: ["LPBank"] },
  { code: "VCCB", bin: "970454", shortName: "VietCapitalBank", name: "Ngân hàng TMCP Bản Việt", logo: "https://api.vietqr.io/img/VCCB.png", aliases: ["BVBank"] },
  { code: "BIDV", bin: "970418", shortName: "BIDV", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam", logo: "https://api.vietqr.io/img/BIDV.png", aliases: [] },
  { code: "STB", bin: "970403", shortName: "Sacombank", name: "Ngân hàng TMCP Sài Gòn Tài Lộc", logo: "https://api.vietqr.io/img/STB.png", aliases: [] },
  { code: "VIB", bin: "970441", shortName: "VIB", name: "Ngân hàng TMCP Quốc tế Việt Nam", logo: "https://api.vietqr.io/img/VIB.png", aliases: [] },
  { code: "HDB", bin: "970437", shortName: "HDBank", name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh", logo: "https://api.vietqr.io/img/HDB.png", aliases: [] },
  { code: "SEAB", bin: "970440", shortName: "SeABank", name: "Ngân hàng TMCP Đông Nam Á", logo: "https://api.vietqr.io/img/SEAB.png", aliases: [] },
  { code: "SHBVN", bin: "970424", shortName: "ShinhanBank", name: "Ngân hàng TNHH MTV Shinhan Việt Nam", logo: "https://api.vietqr.io/img/SHBVN.png", aliases: [] },
  { code: "VBA", bin: "970405", shortName: "Agribank", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam", logo: "https://api.vietqr.io/img/VBA.png", aliases: [] },
  { code: "TCB", bin: "970407", shortName: "Techcombank", name: "Ngân hàng TMCP Kỹ thương Việt Nam", logo: "https://api.vietqr.io/img/TCB.png", aliases: [] },
  { code: "BAB", bin: "970409", shortName: "BacABank", name: "Ngân hàng TMCP Bắc Á", logo: "https://api.vietqr.io/img/BAB.png", aliases: [] },
  { code: "ABB", bin: "970425", shortName: "ABBANK", name: "Ngân hàng TMCP An Bình", logo: "https://api.vietqr.io/img/ABB.png", aliases: [] },
  { code: "EIB", bin: "970431", shortName: "Eximbank", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam", logo: "https://api.vietqr.io/img/EIB.png", aliases: [] },
  { code: "PBVN", bin: "970439", shortName: "PublicBank", name: "Ngân hàng TNHH MTV Public Việt Nam", logo: "https://api.vietqr.io/img/PBVN.png", aliases: [] },
  { code: "OCB", bin: "970448", shortName: "OCB", name: "Ngân hàng TMCP Phương Đông", logo: "https://api.vietqr.io/img/OCB.png", aliases: [] },
  { code: "KLB", bin: "970452", shortName: "KienLongBank", name: "Ngân hàng TMCP Kiên Long", logo: "https://api.vietqr.io/img/KLB.png", aliases: [] },
] as const;

export type VietQrBank = (typeof VIETQR_BANKS)[number];

export function findVietQrBank(code: string | null | undefined): VietQrBank | undefined {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) return undefined;
  return VIETQR_BANKS.find((bank) =>
    bank.code === normalized
    || bank.bin === normalized
    || bank.shortName.toUpperCase() === normalized
    || (bank.aliases as readonly string[]).some((alias) => alias.toUpperCase() === normalized),
  );
}
