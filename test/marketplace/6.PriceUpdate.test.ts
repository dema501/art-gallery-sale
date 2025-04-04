import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";
import hre from "hardhat";

import { getTokenIdFromReceipt } from "../helpers";
import {
  deployMarketplaceFixture,
  listedArtworkFixture,
} from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("6. Price Update (`updatePrice`) - Admin Only", function () {
  const { ONE_ETHER, TWO_ETHER, POINT_FIVE_ETHER } = TEST_CONSTANTS.PRICES;
  const { NON_EXISTENT_ID: NON_EXISTENT_TOKEN_ID } = TEST_CONSTANTS.TOKENS;
  const { TEST_1: TEST_URI_1 } = TEST_CONSTANTS.URI;

  it("6.1 should allow any admin to update price and relist if needed", async function () {
    // First, deploy and set up admin
    const deployData = await loadFixture(deployMarketplaceFixture);
    const { artGallery, owner, designatedAdmin, publicClient } = deployData;

    // Make designatedAdmin an admin
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );
    await artGalleryAsOwner.write.setAdmin([
      getAddress(designatedAdmin.account.address),
      true,
    ]);

    // List an artwork first (as owner)
    const listTx = await artGalleryAsOwner.write.listArtwork([
      TEST_URI_1,
      ONE_ETHER,
    ]);
    const listReceipt = await publicClient.waitForTransactionReceipt({
      hash: listTx,
    });
    const tokenId = await getTokenIdFromReceipt(artGallery, listReceipt);

    if (!tokenId) {
      throw new Error("Failed to get tokenId from listing");
    }

    const artGalleryAsDesignatedAdmin = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: designatedAdmin } },
    );

    // Owner updates price
    const tx1 = await artGalleryAsOwner.write.updatePrice([tokenId, TWO_ETHER]);

    const receipt1 = await publicClient.waitForTransactionReceipt({
      hash: tx1,
    });

    const [price1, isForSale1] = await artGallery.read.getArtwork([tokenId]);
    expect(price1).to.equal(TWO_ETHER);
    expect(isForSale1).to.be.true;

    // Designated admin updates price
    const tx2 = await artGalleryAsDesignatedAdmin.write.updatePrice([
      tokenId,
      POINT_FIVE_ETHER,
    ]);
    const receipt2 = await publicClient.waitForTransactionReceipt({
      hash: tx2,
    });

    const [price2, isForSale2] = await artGallery.read.getArtwork([tokenId]);
    expect(price2).to.equal(POINT_FIVE_ETHER);
    expect(isForSale2).to.be.true;

    // Check events
    const events = await artGallery.getEvents.PriceUpdated(
      {},
      { fromBlock: receipt1.blockNumber, toBlock: receipt2.blockNumber },
    );

    expect(events.length).to.be.greaterThanOrEqual(2);
    expect(events[events.length - 2].args.tokenId).to.equal(tokenId);
    expect(events[events.length - 2].args.newPrice).to.equal(TWO_ETHER);
    expect(events[events.length - 1].args.tokenId).to.equal(tokenId);
    expect(events[events.length - 1].args.newPrice).to.equal(POINT_FIVE_ETHER);
  });

  it("6.2 should NOT allow non-admin (including token owner) to update price", async function () {
    const { artGallery, artist1, otherAccount, tokenId } =
      await loadFixture(listedArtworkFixture); // artist1 owns token
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );
    const artGalleryAsOther = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: otherAccount } },
    );

    // Token owner attempts update
    await expect(
      artGalleryAsArtist.write.updatePrice([tokenId, TWO_ETHER]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin"); // Expect NotAdmin (since onlyAdmin modifier is used)

    // Other account attempts update
    await expect(
      artGalleryAsOther.write.updatePrice([tokenId, TWO_ETHER]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
  });

  it("6.3 should revert updatePrice if price is zero", async function () {
    const { artGallery, owner, tokenId } =
      await loadFixture(listedArtworkFixture);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    await expect(
      artGalleryAsOwner.write.updatePrice([tokenId, 0n]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__PriceMustBeAboveZero");
  });

  it("6.4 should revert updatePrice for non-existent artwork", async function () {
    const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    await expect(
      artGalleryAsOwner.write.updatePrice([NON_EXISTENT_TOKEN_ID, ONE_ETHER]),
    ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts at ownerOf check first
  });
});
