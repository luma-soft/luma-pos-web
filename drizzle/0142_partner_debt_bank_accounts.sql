ALTER TABLE supplier_payable_receipts
  ADD COLUMN bank_account_id uuid REFERENCES payment_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX supplier_payable_receipts_bank_account_idx
  ON supplier_payable_receipts (bank_account_id);

ALTER TABLE customer_receivable_receipts
  ADD COLUMN bank_account_id uuid REFERENCES payment_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX customer_receivable_receipts_bank_account_idx
  ON customer_receivable_receipts (bank_account_id);
