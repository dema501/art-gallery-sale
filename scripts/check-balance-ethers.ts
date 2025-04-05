import hre from "hardhat";
import { formatEther } from "viem";

import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  // Get wallet clients
  const [deployer] = await hre.viem.getWalletClients();

  // Get public client
  const publicClient = await hre.viem.getPublicClient();

  // Get balance
  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });

  console.table({
    Balance: {
      Value: formatEther(balance),
      Unit: "ETH",
    },
    Address: {
      Value: deployer.account.address,
      Unit: "",
    },
  });
}

main().catch(console.error);
