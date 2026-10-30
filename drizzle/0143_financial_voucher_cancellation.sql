ALTER TABLE customer_receivable_receipts
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES profiles(id),
  ADD COLUMN cancellation_reason text;

ALTER TABLE supplier_payable_receipts
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES profiles(id),
  ADD COLUMN cancellation_reason text;

ALTER TABLE cash_transactions
  ADD COLUMN status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES profiles(id),
  ADD COLUMN cancellation_reason text,
  ADD CONSTRAINT cash_transactions_status_check
    CHECK (status IN ('confirmed', 'cancelled'));

CREATE INDEX cash_tx_status_created_idx
  ON cash_transactions (status, created_at DESC);

CREATE UNIQUE INDEX cash_tx_cancellation_reference_idx
  ON cash_transactions (store_id, ref_type, ref_id)
  WHERE ref_type IN (
    'cash_transaction_cancellation',
    'customer_receivable_receipt_cancellation',
    'supplier_payable_receipt_cancellation'
  );
