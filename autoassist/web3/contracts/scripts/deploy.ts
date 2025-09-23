import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying AutoAssist+ Smart Contracts...");

  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

  // Deploy AutoPassport
  console.log("\n📋 Deploying AutoPassport NFT contract...");
  const AutoPassport = await ethers.getContractFactory("AutoPassport");
  const autoPassport = await AutoPassport.deploy(deployer.address);
  await autoPassport.waitForDeployment();
  const autoPassportAddress = await autoPassport.getAddress();
  
  console.log("✅ AutoPassport deployed to:", autoPassportAddress);

  // Deploy PaymentEscrow
  console.log("\n💳 Deploying PaymentEscrow contract...");
  const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
  const paymentEscrow = await PaymentEscrow.deploy(deployer.address, deployer.address);
  await paymentEscrow.waitForDeployment();
  const paymentEscrowAddress = await paymentEscrow.getAddress();
  
  console.log("✅ PaymentEscrow deployed to:", paymentEscrowAddress);

  // Setup initial configuration
  console.log("\n⚙️ Setting up initial configuration...");
  
  // Authorize deployer as service center for testing
  await autoPassport.authorizeServiceCenter(deployer.address, true);
  console.log("🔐 Authorized deployer as service center");
  
  // Authorize deployer as service and insurer for testing
  await paymentEscrow.authorizeService(deployer.address, true);
  await paymentEscrow.authorizeInsurer(deployer.address, true);
  console.log("🔐 Authorized deployer as service and insurer");

  // Create test NFT
  console.log("\n🚗 Creating test vehicle NFT...");
  const testTokenURI = "https://ipfs.io/ipfs/QmTestVehicleMetadata";
  const mintTx = await autoPassport.mintVehiclePassport(
    deployer.address,
    "WBAPH5C58BE123456", // Test VIN
    "AA1234BB",          // Test plate
    "BMW",               // Make
    "X5",                // Model
    2020,                // Year
    testTokenURI         // Token URI
  );
  await mintTx.wait();
  
  console.log("✅ Test vehicle NFT created");

  // Summary
  console.log("\n📊 Deployment Summary:");
  console.log("=".repeat(50));
  console.log(`🏭 Network: ${(await ethers.provider.getNetwork()).name}`);
  console.log(`📋 AutoPassport: ${autoPassportAddress}`);
  console.log(`💳 PaymentEscrow: ${paymentEscrowAddress}`);
  console.log(`👤 Owner: ${deployer.address}`);
  console.log("=".repeat(50));

  // Save deployment info
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId,
    deployer: deployer.address,
    contracts: {
      AutoPassport: autoPassportAddress,
      PaymentEscrow: paymentEscrowAddress
    },
    deployedAt: new Date().toISOString()
  };

  console.log("\n💾 Deployment info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Verification instructions
  console.log("\n🔍 To verify contracts on Polygonscan:");
  console.log(`npx hardhat verify --network polygonAmoy ${autoPassportAddress} "${deployer.address}"`);
  console.log(`npx hardhat verify --network polygonAmoy ${paymentEscrowAddress} "${deployer.address}" "${deployer.address}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });