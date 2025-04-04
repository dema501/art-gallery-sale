import hre from "hardhat";
import { getAddress, parseEther } from "viem";
import { expect } from "chai";
import { getTokenIdFromReceipt } from "../helpers";
import { TEST_CONSTANTS } from "../constants";
const { ONE_ETHER } = TEST_CONSTANTS.PRICES;
const { TEST_1: TEST_URI_1 } = TEST_CONSTANTS.URI;

/**
 * @notice Deploys the ArtGalleryMarketplace contract and returns standard accounts/clients.
 */
export async function deployMarketplaceFixture() {
  // Get multiple accounts for different roles
  const [
    owner,
    artist1,
    artist2,
    buyer1,
    buyer2,
    designatedAdmin,
    otherAccount,
  ] = await hre.viem.getWalletClients();

  // Deploy the contract using the 'owner' account
  const artGallery = await hre.viem.deployContract(
    "ArtGalleryMarketplace",
    [],
    {
      client: { wallet: owner },
    },
  );
  const publicClient = await hre.viem.getPublicClient();

  return {
    artGallery,
    owner, // Contract deployer & initial admin
    artist1,
    artist2,
    buyer1,
    buyer2,
    designatedAdmin, // An account intended to be made admin later
    otherAccount, // A regular user account
    publicClient,
  };
}

/**
 * @notice Deploys the contract and lists one artwork (tokenId 1) by artist1.
 */
export async function listedArtworkFixture() {
  const deployData = await deployMarketplaceFixture();
  const { artGallery, artist1, publicClient } = deployData;

  const artGalleryAsArtist = await hre.viem.getContractAt(
    "ArtGalleryMarketplace",
    artGallery.address,
    { client: { wallet: artist1 } },
  );

  const txHash = await artGalleryAsArtist.write.listArtwork([
    TEST_URI_1,
    ONE_ETHER,
  ]);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  const tokenId = await getTokenIdFromReceipt(artGallery, receipt);

  const events3 = await artGallery.getEvents.ArtworkListed();

  if (tokenId === null) {
    throw new Error(
      "listedArtworkFixture: Failed to retrieve tokenId from ArtworkListed event.",
    );
  }
  // Specific check for fixture setup
  expect(tokenId).to.equal(1n);

  return { ...deployData, tokenId };
}

/**
 * @notice Deploys, lists one artwork, and sells it to buyer1.
 */
export async function soldArtworkFixture() {
  const listedData = await listedArtworkFixture();
  const { artGallery, buyer1, publicClient, tokenId } = listedData;

  const artGalleryAsBuyer = await hre.viem.getContractAt(
    "ArtGalleryMarketplace",
    artGallery.address,
    { client: { wallet: buyer1 } },
  );

  const buyTxHash = await artGalleryAsBuyer.write.buyArtwork([tokenId], {
    value: ONE_ETHER,
  });
  await publicClient.waitForTransactionReceipt({ hash: buyTxHash });

  return { ...listedData }; // buyer1 is now the owner of tokenId
}

/**
 * @notice Deploys the contract and designates an additional admin account.
 */
export async function designatedAdminFixture() {
  const deployData = await deployMarketplaceFixture();
  const { artGallery, owner, designatedAdmin, publicClient } = deployData;
  const artGalleryAsOwner = await hre.viem.getContractAt(
    "ArtGalleryMarketplace",
    artGallery.address,
    { client: { wallet: owner } },
  );
  const txHash = await artGalleryAsOwner.write.setAdmin([
    getAddress(designatedAdmin.account.address),
    true,
  ]);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Verify admin was set
  expect(
    await artGallery.read.isAdmin([
      getAddress(designatedAdmin.account.address),
    ]),
  ).to.be.true;

  return deployData; // Contains the designatedAdmin who is now admin
}
