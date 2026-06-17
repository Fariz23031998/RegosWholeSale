from pydantic import BaseModel, Field


class FeaturedProductsResponse(BaseModel):
    product_ids: list[int] = Field(default_factory=list)


class FeaturedProductMutationResponse(BaseModel):
    product_ids: list[int] = Field(default_factory=list)
    featured: bool
