import hre from "hardhat";
async function main() {
  // Get the address from task arguments
  const address = process.env.CONTRACT_ADDRESS;

  if (!address) {
    throw new Error("CONTRACT_ADDRESS environment variable is required");
  }

  const artGallery = await hre.viem.getContractAt(
    // @ts-ignore
    "ArtGalleryMarketplace",
    address
  );

  const [owner] = await hre.viem.getWalletClients();
  const ownerAddress = owner.account.address;

  // @ts-ignore
  const isAdmin = await artGallery.read.isAdmin([ownerAddress]);
  console.log("Owner address:", ownerAddress);
  console.log("Is admin?", isAdmin);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
