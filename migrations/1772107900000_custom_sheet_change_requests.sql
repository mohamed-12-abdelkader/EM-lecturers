CREATE TABLE IF NOT EXISTS custom_sheet_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id UUID NOT NULL REFERENCES custom_sheets(id) ON DELETE CASCADE,
    row_id UUID REFERENCES custom_sheet_rows(id) ON DELETE CASCADE,
    action VARCHAR(30) NOT NULL CHECK (action IN ('update_sheet', 'delete_sheet', 'update_row', 'delete_row')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    admin_note TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_custom_sheet_change_requests_status
ON custom_sheet_change_requests(status);

CREATE INDEX IF NOT EXISTS idx_custom_sheet_change_requests_sheet_id
ON custom_sheet_change_requests(sheet_id);
