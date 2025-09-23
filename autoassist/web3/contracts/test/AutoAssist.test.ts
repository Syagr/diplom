import { expect } from "chai";
import { ethers } from "hardhat";
import { AutoPassport, PaymentEscrow } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AutoAssist+ Smart Contracts", function () {
  let autoPassport: AutoPassport;
  let paymentEscrow: PaymentEscrow;
  let owner: SignerWithAddress;
  let serviceCenter: SignerWithAddress;
  let client: SignerWithAddress;
  let insurer: SignerWithAddress;

  beforeEach(async function () {
    [owner, serviceCenter, client, insurer] = await ethers.getSigners();

    // Deploy AutoPassport
    const AutoPassportFactory = await ethers.getContractFactory("AutoPassport");
    autoPassport = await AutoPassportFactory.deploy(owner.address);

    // Deploy PaymentEscrow
    const PaymentEscrowFactory = await ethers.getContractFactory("PaymentEscrow");
    paymentEscrow = await PaymentEscrowFactory.deploy(owner.address, owner.address);

    // Setup authorizations
    await autoPassport.authorizeServiceCenter(serviceCenter.address, true);
    await paymentEscrow.authorizeService(serviceCenter.address, true);
    await paymentEscrow.authorizeInsurer(insurer.address, true);
  });

  describe("AutoPassport", function () {
    it("Should mint vehicle NFT with correct data", async function () {
      const vin = "WBAPH5C58BE123456";
      const plate = "AA1234BB";
      const make = "BMW";
      const model = "X5";
      const year = 2020;
      const tokenURI = "https://ipfs.io/ipfs/test";

      await expect(
        autoPassport.mintVehiclePassport(
          client.address,
          vin,
          plate,
          make,
          model,
          year,
          tokenURI
        )
      ).to.emit(autoPassport, "VehicleCreated");

      const tokenId = await autoPassport.getTokenByVIN(vin);
      expect(tokenId).to.equal(1);

      const vehicleData = await autoPassport.getVehicleData(tokenId);
      expect(vehicleData.vin).to.equal(vin);
      expect(vehicleData.plate).to.equal(plate);
      expect(vehicleData.make).to.equal(make);
      expect(vehicleData.model).to.equal(model);
      expect(vehicleData.year).to.equal(year);
      expect(vehicleData.originalOwner).to.equal(client.address);

      expect(await autoPassport.ownerOf(tokenId)).to.equal(client.address);
    });

    it("Should prevent duplicate VIN", async function () {
      const vin = "WBAPH5C58BE123456";
      
      await autoPassport.mintVehiclePassport(
        client.address,
        vin,
        "AA1234BB",
        "BMW",
        "X5",
        2020,
        "https://ipfs.io/ipfs/test"
      );

      await expect(
        autoPassport.mintVehiclePassport(
          client.address,
          vin,
          "BB5678CC",
          "Mercedes",
          "E-Class",
          2021,
          "https://ipfs.io/ipfs/test2"
        )
      ).to.be.revertedWith("VIN already exists");
    });

    it("Should add service record from authorized service center", async function () {
      // First mint a vehicle
      await autoPassport.mintVehiclePassport(
        client.address,
        "WBAPH5C58BE123456",
        "AA1234BB",
        "BMW",
        "X5",
        2020,
        "https://ipfs.io/ipfs/test"
      );

      const tokenId = 1;
      const orderId = 123;
      const serviceType = "repair";
      const mileage = 50000;
      const cost = ethers.parseEther("1.5");
      const description = "Engine repair";
      const ipfsHash = "QmTestHash";

      await expect(
        autoPassport.connect(serviceCenter).addServiceRecord(
          tokenId,
          orderId,
          serviceType,
          mileage,
          cost,
          description,
          ipfsHash
        )
      ).to.emit(autoPassport, "ServiceRecordAdded");

      const history = await autoPassport.getServiceHistory(tokenId);
      expect(history.length).to.equal(1);
      expect(history[0].orderId).to.equal(orderId);
      expect(history[0].serviceType).to.equal(serviceType);
      expect(history[0].mileage).to.equal(mileage);
      expect(history[0].cost).to.equal(cost);
      expect(history[0].serviceCenter).to.equal(serviceCenter.address);
    });

    it("Should prevent unauthorized service record addition", async function () {
      await autoPassport.mintVehiclePassport(
        client.address,
        "WBAPH5C58BE123456",
        "AA1234BB",
        "BMW",
        "X5",
        2020,
        "https://ipfs.io/ipfs/test"
      );

      await expect(
        autoPassport.connect(client).addServiceRecord(
          1,
          123,
          "repair",
          50000,
          ethers.parseEther("1.5"),
          "Engine repair",
          "QmTestHash"
        )
      ).to.be.revertedWith("Not authorized service center");
    });
  });

  describe("PaymentEscrow", function () {
    it("Should create payment and hold funds in escrow", async function () {
      const orderId = 123;
      const serviceAmount = ethers.parseEther("1.0");
      const insuranceAmount = ethers.parseEther("0.5");
      const totalAmount = serviceAmount + insuranceAmount;
      const ipfsHash = "QmTestPayment";

      await expect(
        paymentEscrow.connect(client).createPayment(
          orderId,
          serviceCenter.address,
          serviceAmount,
          insuranceAmount,
          insurer.address,
          ipfsHash,
          { value: totalAmount }
        )
      ).to.emit(paymentEscrow, "PaymentCreated");

      const payment = await paymentEscrow.getPayment(1);
      expect(payment.orderId).to.equal(orderId);
      expect(payment.payer).to.equal(client.address);
      expect(payment.payee).to.equal(serviceCenter.address);
      expect(payment.amount).to.equal(totalAmount);
      expect(payment.status).to.equal(1); // ESCROWED
    });

    it("Should complete payment when both parties confirm", async function () {
      const serviceAmount = ethers.parseEther("1.0");
      const insuranceAmount = ethers.parseEther("0.5");
      const totalAmount = serviceAmount + insuranceAmount;

      // Create payment
      await paymentEscrow.connect(client).createPayment(
        123,
        serviceCenter.address,
        serviceAmount,
        insuranceAmount,
        insurer.address,
        "QmTestPayment",
        { value: totalAmount }
      );

      const initialServiceBalance = await ethers.provider.getBalance(serviceCenter.address);
      const initialInsurerBalance = await ethers.provider.getBalance(insurer.address);

      // Service center confirms completion
      await paymentEscrow.connect(serviceCenter).confirmServiceCompleted(1);

      // Client approves service
      await expect(
        paymentEscrow.connect(client).approveService(1)
      ).to.emit(paymentEscrow, "PaymentCompleted");

      const finalServiceBalance = await ethers.provider.getBalance(serviceCenter.address);
      const finalInsurerBalance = await ethers.provider.getBalance(insurer.address);

      // Check that payments were made (minus fees)
      expect(finalServiceBalance).to.be.gt(initialServiceBalance);
      expect(finalInsurerBalance).to.be.gt(initialInsurerBalance);

      const payment = await paymentEscrow.getPayment(1);
      expect(payment.status).to.equal(2); // COMPLETED
    });

    it("Should allow refund if payment expires", async function () {
      const totalAmount = ethers.parseEther("1.5");

      await paymentEscrow.connect(client).createPayment(
        123,
        serviceCenter.address,
        ethers.parseEther("1.0"),
        ethers.parseEther("0.5"),
        insurer.address,
        "QmTestPayment",
        { value: totalAmount }
      );

      // Fast forward time beyond expiry
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]); // 8 days
      await ethers.provider.send("evm_mine", []);

      const initialClientBalance = await ethers.provider.getBalance(client.address);

      await expect(
        paymentEscrow.connect(client).refundPayment(1)
      ).to.emit(paymentEscrow, "PaymentRefunded");

      const finalClientBalance = await ethers.provider.getBalance(client.address);
      expect(finalClientBalance).to.be.gt(initialClientBalance);
    });

    it("Should create and resolve dispute", async function () {
      const totalAmount = ethers.parseEther("1.5");

      await paymentEscrow.connect(client).createPayment(
        123,
        serviceCenter.address,
        ethers.parseEther("1.0"),
        ethers.parseEther("0.5"),
        insurer.address,
        "QmTestPayment",
        { value: totalAmount }
      );

      // Create dispute
      await expect(
        paymentEscrow.connect(client).createDispute(1, "Service not completed properly")
      ).to.emit(paymentEscrow, "DisputeCreated");

      const dispute = await paymentEscrow.getDispute(1);
      expect(dispute.paymentId).to.equal(1);
      expect(dispute.initiator).to.equal(client.address);
      expect(dispute.resolved).to.equal(false);

      // Resolve dispute in favor of client
      await expect(
        paymentEscrow.connect(owner).resolveDispute(1, client.address)
      ).to.emit(paymentEscrow, "DisputeResolved");

      const resolvedDispute = await paymentEscrow.getDispute(1);
      expect(resolvedDispute.resolved).to.equal(true);
      expect(resolvedDispute.winner).to.equal(client.address);
    });

    it("Should prevent unauthorized service creation", async function () {
      await expect(
        paymentEscrow.connect(client).createPayment(
          123,
          client.address, // Unauthorized service
          ethers.parseEther("1.0"),
          0,
          ethers.ZeroAddress,
          "QmTestPayment",
          { value: ethers.parseEther("1.0") }
        )
      ).to.be.revertedWith("Service not authorized");
    });
  });

  describe("Integration", function () {
    it("Should create complete flow: NFT -> Payment -> Service Record", async function () {
      // 1. Mint vehicle NFT
      await autoPassport.mintVehiclePassport(
        client.address,
        "WBAPH5C58BE123456",
        "AA1234BB",
        "BMW",
        "X5",
        2020,
        "https://ipfs.io/ipfs/test"
      );

      const tokenId = await autoPassport.getTokenByVIN("WBAPH5C58BE123456");

      // 2. Create payment
      const orderId = 123;
      const serviceAmount = ethers.parseEther("1.0");
      
      await paymentEscrow.connect(client).createPayment(
        orderId,
        serviceCenter.address,
        serviceAmount,
        0,
        ethers.ZeroAddress,
        "QmTestPayment",
        { value: serviceAmount }
      );

      // 3. Complete service and payment
      await paymentEscrow.connect(serviceCenter).confirmServiceCompleted(1);
      await paymentEscrow.connect(client).approveService(1);

      // 4. Add service record to NFT
      await autoPassport.connect(serviceCenter).addServiceRecord(
        tokenId,
        orderId,
        "repair",
        50000,
        serviceAmount,
        "Engine repair completed",
        "QmServiceRecord"
      );

      // Verify complete flow
      const vehicleHistory = await autoPassport.getServiceHistory(tokenId);
      expect(vehicleHistory.length).to.equal(1);
      expect(vehicleHistory[0].orderId).to.equal(orderId);

      const payment = await paymentEscrow.getPayment(1);
      expect(payment.status).to.equal(2); // COMPLETED
    });
  });
});