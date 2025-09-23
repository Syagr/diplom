import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    polygonAmoy: {
      url: process.env.WEB3_RPC_URL || "https://rpc-amoy.polygon.technology/",
      accounts: process.env.WEB3_PRIVATE_KEY ? [process.env.WEB3_PRIVATE_KEY] : [],
      chainId: 80002
    },
    polygonMumbai: {
      url: process.env.WEB3_RPC_URL || "https://polygon-mumbai.infura.io/v3/",
      accounts: process.env.WEB3_PRIVATE_KEY ? [process.env.WEB3_PRIVATE_KEY] : [],
      chainId: 80001
    }
  },
  etherscan: {
    apiKey: {
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || ""
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};

export default config;