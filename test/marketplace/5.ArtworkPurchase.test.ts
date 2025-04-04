import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";
import hre from "hardhat";

import {
  deployMarketplaceFixture,
  listedArtworkFixture,
  soldArtworkFixture,
} from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("5. Artwork Purchase (`buyArtwork`)", function () {
  const { ONE_ETHER, TWO_ETHER, POINT_FIVE_ETHER } = TEST_CONSTANTS.PRICES;
  const { NON_EXISTENT_ID: NON_EXISTENT_TOKEN_ID } = TEST_CONSTANTS.TOKENS;

  it("5.1 should allow purchasing listed artwork with exact payment", async function () {
    const { artGallery, artist1, buyer1, publicClient, tokenId } =
      await loadFixture(listedArtworkFixture);
    const artistAddress = getAddress(artist1.account.address);
    const buyerAddress = getAddress(buyer1.account.address);
    const artGalleryAsBuyer = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer1 } },
    );

    const initialArtistBalance = await publicClient.getBalance({
      address: artistAddress,
    });
    const initialBuyerBalance = await publicClient.getBalance({
      address: buyerAddress,
    });

    const txHash = await artGalleryAsBuyer.write.buyArtwork([tokenId], {
      value: ONE_ETHER,
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

    // Verify events
    const events = await artGallery.getEvents.ArtworkSold(
      {},
      { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
    );
    expect(events).to.have.lengthOf(1); // Only one sale happened in this tx
    expect(events[0].args.tokenId).to.equal(tokenId);
    expect(events[0].args.seller).to.equal(artistAddress);
    expect(events[0].args.buyer).to.equal(buyerAddress);
    expect(events[0].args.price).to.equal(ONE_ETHER);

    // Verify state changes
    expect(await artGallery.read.ownerOf([tokenId])).to.equal(buyerAddress);
    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

    // Verify balance changes (assuming zero royalty fee)
    const finalArtistBalance = await publicClient.getBalance({
      address: artistAddress,
    });
    const finalBuyerBalance = await publicClient.getBalance({
      address: buyerAddress,
    });
    expect(finalArtistBalance).to.equal(initialArtistBalance + ONE_ETHER);
    expect(finalBuyerBalance).to.equal(
      initialBuyerBalance - ONE_ETHER - gasUsed,
    );
  });

  it("5.2 should distribute funds correctly with non-zero royalty during purchase", async function () {
    const { artGallery, owner, artist1, buyer1, publicClient, tokenId } =
      await loadFixture(listedArtworkFixture);
    const artistAddress = getAddress(artist1.account.address); // Original artist AND initial seller
    const buyerAddress = getAddress(buyer1.account.address);
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );
    const artGalleryAsBuyer = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer1 } },
    );

    // Set royalty fee
    const royaltyFeeBps = 1000n; // 10%
    const royaltyTx = await artGalleryAsOwner.write.setRoyaltyFee([
      royaltyFeeBps,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: royaltyTx });

    const initialArtistBalance = await publicClient.getBalance({
      address: artistAddress,
    });
    const initialBuyerBalance = await publicClient.getBalance({
      address: buyerAddress,
    });

    const salePrice = ONE_ETHER;
    const expectedRoyalty = (salePrice * royaltyFeeBps) / 10000n;
    const expectedSellerProceeds = salePrice - expectedRoyalty;

    // Buyer purchases
    const buyTxHash = await artGalleryAsBuyer.write.buyArtwork([tokenId], {
      value: salePrice,
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: buyTxHash,
    });
    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

    // Verify balance changes
    const finalArtistBalance = await publicClient.getBalance({
      address: artistAddress,
    });
    const finalBuyerBalance = await publicClient.getBalance({
      address: buyerAddress,
    });

    // In this specific case, the Artist is also the Seller, so they receive both portions.
    expect(finalArtistBalance).to.equal(
      initialArtistBalance + expectedSellerProceeds + expectedRoyalty,
    );

    expect(finalBuyerBalance).to.equal(
      initialBuyerBalance - salePrice - gasUsed,
    );
  });

  it("5.3 should revert purchase if payment is not exact (insufficient or excessive)", async function () {
    const { artGallery, buyer1, tokenId } =
      await loadFixture(listedArtworkFixture);
    const artGalleryAsBuyer = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer1 } },
    );

    // Insufficient
    await expect(
      artGalleryAsBuyer.write.buyArtwork([tokenId], {
        value: POINT_FIVE_ETHER,
      }),
    ).to.be.rejectedWith("ArtGalleryMarketplace__ExactPaymentRequired");

    // Excessive
    await expect(
      artGalleryAsBuyer.write.buyArtwork([tokenId], { value: TWO_ETHER }),
    ).to.be.rejectedWith("ArtGalleryMarketplace__ExactPaymentRequired");
  });

  it("5.4 should revert purchase for non-existent artwork", async function () {
    const { artGallery, buyer1 } = await loadFixture(deployMarketplaceFixture);
    const artGalleryAsBuyer = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer1 } },
    );

    await expect(
      artGalleryAsBuyer.write.buyArtwork([NON_EXISTENT_TOKEN_ID], {
        value: ONE_ETHER,
      }),
    ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts at ownerOf check
  });

  it("5.5 should revert purchase for artwork not for sale (sold or delisted)", async function () {
    const soldData = await loadFixture(soldArtworkFixture); // Artwork sold to buyer1
    const { artGallery, owner, buyer2, publicClient, tokenId } = soldData;
    const artGalleryAsBuyer2 = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer2 } },
    );
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    // Attempt to buy already sold artwork
    await expect(
      artGalleryAsBuyer2.write.buyArtwork([tokenId], { value: ONE_ETHER }),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotForSale");

    // Delist the already sold artwork (admin action) - this should succeed but is just for setup
    const delistTx = await artGalleryAsOwner.write.delistArtwork([tokenId]);
    await publicClient.waitForTransactionReceipt({ hash: delistTx });
    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

    // Attempt to buy delisted artwork
    await expect(
      artGalleryAsBuyer2.write.buyArtwork([tokenId], { value: ONE_ETHER }),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotForSale");
  });
});
