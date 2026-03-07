CREATE DATABASE hotspot;
USE hotspot;

CREATE TABLE paid_devices (
    mac VARCHAR(17) PRIMARY KEY,
    ip VARCHAR(15),
    email VARCHAR(100),
    plan ENUM('daily', 'weekly', 'monthly') DEFAULT 'daily',
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    active TINYINT(1) DEFAULT 1
);

-- Example insert (for testing)
INSERT INTO paid_devices (mac, email, plan, expires_at, active)
VALUES ('AA:BB:CC:DD:EE:FF', 'test@example.com', 'daily', DATE_ADD(NOW(), INTERVAL 1 DAY), 1);