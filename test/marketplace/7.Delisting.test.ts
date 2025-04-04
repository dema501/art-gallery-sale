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

describe("7. Delisting (`delistArtwork`) - Admin Only", function () {
  const { ONE_ETHER } = TEST_CONSTANTS.PRICES;
  const { NON_EXISTENT_ID: NON_EXISTENT_TOKEN_ID } = TEST_CONSTANTS.TOKENS;
  const { TEST_1: TEST_URI_1 } = TEST_CONSTANTS.URI;

  it("7.1 should allow any admin to delist artwork", async function () {
    // First deploy and set up initial state
    const { artGallery, owner, designatedAdmin, publicClient } =
      await loadFixture(deployMarketplaceFixture);

    // Make designatedAdmin an admin
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    // Set up admin
    await artGalleryAsOwner.write.setAdmin([
      getAddress(designatedAdmin.account.address),
      true,
    ]);

    // List an artwork first
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

    // Verify artwork is initially for sale
    expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.true;

    // Owner delists
    const tx1 = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
    const receipt1 = await publicClient.waitForTransactionReceipt({
      hash: tx1,
    });
    expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;

    // Relist it by updating price
    await artGalleryAsOwner.write.updatePrice([tokenId, ONE_ETHER]);
    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.true;

    // Designated admin delists
    const tx2 = await artGalleryAsDesignatedAdmin.write.delistArtwork([
      tokenId,
    ]);

    const receipt2 = await publicClient.waitForTransactionReceipt({
      hash: tx2,
    });
    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

    // Check second delist event
    const events = await artGallery.getEvents.ArtworkDelisted(
      {},
      { fromBlock: receipt1.blockNumber, toBlock: receipt2.blockNumber },
    );
    expect(events.length).to.be.greaterThanOrEqual(2);
    expect(events[0].args.tokenId).to.equal(tokenId);
    expect(events[0].blockNumber).to.equal(receipt1.blockNumber);

    expect(events[events.length - 1].args.tokenId).to.equal(tokenId);
    expect(events[events.length - 1].blockNumber).to.equal(
      receipt2.blockNumber,
    );
  });

  it("7.2 should NOT allow non-admin (including token owner) to delist artwork", async function () {
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

    // Token owner attempts delist
    await expect(
      artGalleryAsArtist.write.delistArtwork([tokenId]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");

    // Other account attempts delist
    await expect(
      artGalleryAsOther.write.delistArtwork([tokenId]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
  });

  it("7.3 should revert delisting non-existent artwork", async function () {
    const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    await expect(
      artGalleryAsOwner.write.delistArtwork([NON_EXISTENT_TOKEN_ID]),
    ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts at ownerOf check
  });

  it("7.4 should succeed but have no effect when admin delists already delisted artwork", async function () {
    const { artGallery, owner, publicClient, tokenId } =
      await loadFixture(listedArtworkFixture);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    // Delist first time
    const tx1 = await artGalleryAsOwner.write.delistArtwork([tokenId]);
    await publicClient.waitForTransactionReceipt({ hash: tx1 });
    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

    // Delist second time - should not revert
    await expect(artGalleryAsOwner.write.delistArtwork([tokenId])).to.not.be
      .rejected;

    // State remains unchanged
    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;
  });
});
