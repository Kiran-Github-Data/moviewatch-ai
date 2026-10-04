-- Milestone 5: agentic booking — Stripe customers/payment methods,
-- auto-book consent fields on watches.

-- Stripe customer reference on users
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

-- Saved payment methods (Stripe references only; no PAN data)
CREATE TABLE "PaymentMethod" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stripePaymentMethodId" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "expMonth" INTEGER NOT NULL,
  "expYear" INTEGER NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentMethod_stripePaymentMethodId_key" ON "PaymentMethod"("stripePaymentMethodId");
CREATE INDEX "PaymentMethod_userId_idx" ON "PaymentMethod"("userId");
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Auto-booking consent + spending cap on watches
ALTER TABLE "MovieWatch"
  ADD COLUMN "autoBookEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consentAt" TIMESTAMP(3),
  ADD COLUMN "maxTotalCents" INTEGER;
