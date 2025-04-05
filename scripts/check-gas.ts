import hre from "hardhat";
import { formatGwei } from "viem";

import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const gasPrice = await publicClient.getGasPrice();
  const block = await publicClient.getBlock();

  console.table({
    "Current Gas Price": {
      Value: formatGwei(gasPrice),
      Unit: "gwei",
      Raw: gasPrice.toString(),
    },
    "Base Fee Per Gas": {
      Value: block.baseFeePerGas ? formatGwei(block.baseFeePerGas) : "N/A",
      Unit: "gwei",
      Raw: block.baseFeePerGas?.toString() || "N/A",
    },
  });
}

main()
  .then(() => process.exit(0))
  .catch(console.error);
