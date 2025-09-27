INSERT INTO "User" (email, "passwordHash", role, "createdAt", "updatedAt")
VALUES ('admin@example.com', '$2a$10$EIfib1jdjtSOxo36wyrQ8ORGEnqW0aLjJ5AnCLS17zKG7W/.2.jkK', 'admin', now(), now())
ON CONFLICT (email) DO NOTHING;
