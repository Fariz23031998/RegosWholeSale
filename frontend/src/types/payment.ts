export type PaymentType = {
  id: number;
  name: string;
  is_cash: boolean;
  image_url: string;
};

export type PaymentTypesResponse = {
  payment_types: PaymentType[];
};
