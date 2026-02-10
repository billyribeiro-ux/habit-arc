ALTER TABLE users
    DROP COLUMN IF EXISTS subscription_tier,
    DROP COLUMN IF EXISTS subscription_status,
    DROP COLUMN IF EXISTS stripe_customer_id;
