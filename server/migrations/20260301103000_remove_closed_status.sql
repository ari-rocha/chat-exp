UPDATE sessions
SET status = 'resolved', updated_at = NOW()::text
WHERE lower(status) = 'closed';
