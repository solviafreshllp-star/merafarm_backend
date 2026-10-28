-- AlterTable
ALTER TABLE "Order" ADD COLUMN "razorpayOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_razorpayOrderId_key" ON "Order"("razorpayOrderId");
