import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";
import hre from "hardhat";

import { deployMarketplaceFixture } from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("11. Batch Listing Operations", function () {
  const { ONE_ETHER, TWO_ETHER, POINT_FIVE_ETHER } = TEST_CONSTANTS.PRICES;
  const {
    TEST_1: TEST_URI_1,
    TEST_2: TEST_URI_2,
    TEST_3: TEST_URI_3,
  } = TEST_CONSTANTS.URI;

  it("11.1 should allow batch listing of multiple artworks", async function () {
    const { artGallery, artist1, publicClient } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    const uris = [TEST_URI_1, TEST_URI_2, TEST_URI_3];
    const prices = [ONE_ETHER, TWO_ETHER, POINT_FIVE_ETHER];

    const tx = await artGalleryAsArtist.write.batchListArtworks([uris, prices]);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: tx,
    });

    const events = await artGallery.getEvents.BatchArtworksListed({
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    expect(events.length).to.equal(1);
    expect(events[0].args.tokenIds?.length).to.equal(3);

    // Verify each artwork
    for (let i = 0; i < uris.length; i++) {
      const tokenId = events[0].args.tokenIds?.[i];
      const [price, isForSale, artist] = await artGallery.read.getArtwork([
        tokenId!,
      ]);
      expect(price).to.equal(prices[i]);
      expect(isForSale).to.be.true;
      expect(artist).to.equal(getAddress(artist1.account.address));
      expect(await artGallery.read.tokenURI([tokenId!])).to.equal(uris[i]);
    }
  });

  it("11.2 should revert batch listing with mismatched arrays", async function () {
    const { artGallery, artist1 } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    await expect(
      artGalleryAsArtist.write.batchListArtworks([
        [TEST_URI_1, TEST_URI_2],
        [ONE_ETHER],
      ]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__ArrayLengthMismatch");
  });

  it("11.3 should revert batch listing with empty arrays", async function () {
    const { artGallery, artist1 } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    await expect(
      artGalleryAsArtist.write.batchListArtworks([[], []]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__EmptyArraysNotAllowed");
  });

  it("11.4 should revert batch listing if any price exceeds max price", async function () {
    const { artGallery, artist1 } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    const maxPrice = await artGallery.read.maxPrice();
    await expect(
      artGalleryAsArtist.write.batchListArtworks([
        [TEST_URI_1],
        [maxPrice + 1n],
      ]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__PriceExceedsMaximum");
  });
});
