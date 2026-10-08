-- Replay protection for TOTP codes (Phase 22 S-28)
ALTER TABLE "identities" ADD COLUMN "twoFactorLastStep" INTEGER;
