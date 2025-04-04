import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";
import hre from "hardhat";

import { getTokenIdFromReceipt } from "../helpers";
import { deployMarketplaceFixture } from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("4. Artwork Listing (`listArtwork`)", function () {
  const { ONE_ETHER, TWO_ETHER } = TEST_CONSTANTS.PRICES;
  const { TEST_1: TEST_URI_1, TEST_2: TEST_URI_2 } = TEST_CONSTANTS.URI;

  it("4.1 should allow listing artwork with valid inputs and verify all states", async function () {
    const { artGallery, artist1, publicClient } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artistAddress = getAddress(artist1.account.address);
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    const initialTotalArtworks = await artGallery.read.getTotalArtworks();

    const txHash = await artGalleryAsArtist.write.listArtwork([
      TEST_URI_1,
      ONE_ETHER,
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const tokenId = await getTokenIdFromReceipt(artGallery, receipt);
    expect(tokenId).to.not.be.null;
    expect(tokenId).to.equal(initialTotalArtworks + 1n);

    // Verify all states and events
    const events = await artGallery.getEvents.ArtworkListed(
      {},
      { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
    );
    const eventArgs = events.find((e) => e.args.tokenId === tokenId)?.args;
    expect(eventArgs).to.exist;
    expect(eventArgs?.artist).to.equal(artistAddress);
    expect(eventArgs?.price).to.equal(ONE_ETHER);

    expect(await artGallery.read.ownerOf([tokenId!])).to.equal(artistAddress);
    expect(await artGallery.read.tokenURI([tokenId!])).to.equal(TEST_URI_1);

    const [price, isForSale, originalArtist] = await artGallery.read.getArtwork(
      [tokenId!],
    );
    expect(price).to.equal(ONE_ETHER);
    expect(isForSale).to.be.true;
    expect(originalArtist).to.equal(artistAddress);
    expect(await artGallery.read.getTotalArtworks()).to.equal(
      initialTotalArtworks + 1n,
    );
  });

  it("4.2 should maintain incremental token IDs across different listings", async function () {
    const { artGallery, artist1, artist2, publicClient } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artGalleryAsArtist1 = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );
    const artGalleryAsArtist2 = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist2 } },
    );

    const tx1 = await artGalleryAsArtist1.write.listArtwork([
      TEST_URI_1,
      ONE_ETHER,
    ]);
    const receipt1 = await publicClient.waitForTransactionReceipt({
      hash: tx1,
    });
    const tokenId1 = await getTokenIdFromReceipt(artGallery, receipt1);
    expect(tokenId1).to.equal(1n);

    const tx2 = await artGalleryAsArtist2.write.listArtwork([
      TEST_URI_2,
      TWO_ETHER,
    ]);
    const receipt2 = await publicClient.waitForTransactionReceipt({
      hash: tx2,
    });
    const tokenId2 = await getTokenIdFromReceipt(artGallery, receipt2);
    expect(tokenId2).to.equal(tokenId1! + 1n);
    expect(await artGallery.read.getTotalArtworks()).to.equal(tokenId2);
  });

  it("4.3 should revert for invalid inputs (zero price, empty URI, price above max)", async function () {
    const { artGallery, artist1 } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    const maxPrice = await artGallery.read.maxPrice();

    await expect(
      artGalleryAsArtist.write.listArtwork([TEST_URI_1, 0n]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__PriceMustBeAboveZero");

    await expect(
      artGalleryAsArtist.write.listArtwork(["", ONE_ETHER]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__EmptyURINotAllowed");

    await expect(
      artGalleryAsArtist.write.listArtwork([TEST_URI_1, maxPrice + 1n]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__PriceExceedsMaximum");
  });
});
