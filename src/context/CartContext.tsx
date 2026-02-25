// CAMINHO: src/context/CartContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useToast } from "@/context/ToastContext"; // Usando seu sistema de feedback

// Definição do Produto no Carrinho
export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  // Adicionei opcionais caso tenha variações no futuro
  size?: string; 
  color?: string;
}

interface CartContextData {
  items: CartItem[];
  addToCart: (product: CartItem) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, amount: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const CartContext = createContext<CartContextData>({} as CartContextData);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const { addToast } = useToast();

  // 1. Carregar do LocalStorage ao iniciar
  useEffect(() => {
    const storedCart = localStorage.getItem("@AAAKN:cart");
    if (storedCart) {
      setItems(JSON.parse(storedCart));
    }
  }, []);

  // 2. Salvar no LocalStorage sempre que mudar
  useEffect(() => {
    localStorage.setItem("@AAAKN:cart", JSON.stringify(items));
  }, [items]);

  // Função: Adicionar ao Carrinho
  const addToCart = (product: CartItem) => {
    setItems((currentItems) => {
      const itemExists = currentItems.find((item) => item.id === product.id);

      if (itemExists) {
        // Se já existe, só aumenta a quantidade
        addToast("Quantidade atualizada na mochila! 🎒", "success");
        return currentItems.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        // Se não existe, adiciona novo
        addToast("Item guardado com os tubarões! 🦈", "success");
        return [...currentItems, { ...product, quantity: 1 }];
      }
    });
  };

  // Função: Remover do Carrinho
  const removeFromCart = (productId: string) => {
    setItems((currentItems) => currentItems.filter((item) => item.id !== productId));
    addToast("Item devolvido para a prateleira.", "info");
  };

  // Função: Atualizar Quantidade (ex: botão + e - no carrinho)
  const updateQuantity = (productId: string, amount: number) => {
    setItems((currentItems) =>
      currentItems.map((item) => {
        if (item.id === productId) {
          const newQuantity = Math.max(1, amount); // Não deixa ser 0
          return { ...item, quantity: newQuantity };
        }
        return item;
      })
    );
  };

  // Função: Limpar Carrinho (após compra)
  const clearCart = () => {
    setItems([]);
    localStorage.removeItem("@AAAKN:cart");
  };

  // Cálculos derivados
  const total = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const itemCount = items.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        total,
        itemCount,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

// Hook personalizado para usar fácil
export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart deve ser usado dentro de um CartProvider");
  }
  return context;
}