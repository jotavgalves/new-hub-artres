import { onRequestDelete as deleteOrder } from "../orders.js";

export async function onRequestPost(context) {
  return deleteOrder(context);
}

export async function onRequestDelete(context) {
  return deleteOrder(context);
}
