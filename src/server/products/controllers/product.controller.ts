// src/server/products/controllers/product.controller.ts
import { Request, Response, NextFunction } from 'express';
import { productService } from '../services/product.service';
import { CreateProductDTO, UpdateProductDTO } from '../dtos/product.dto';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';

export class ProductController {
  async getProducts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const businessId = req.businessId!;
      const query = req.query as any; // Will be properly validated by middleware later

      const result = await productService.listProducts(businessId, query);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getProductById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const businessId = req.businessId!;

      const product = await productService.getProductById(id, businessId);

      res.json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }

  async createProduct(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const dto = req.body as CreateProductDTO;
      const businessId = req.businessId!;
      const userId = req.user?.id;

      const product = await productService.createProduct(dto, businessId, userId);

      res.status(201).json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProduct(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = (req.params.id as string) || '';
      const dto = req.body as UpdateProductDTO;
      const businessId = req.businessId!;

      const product = await productService.updateProduct(id, dto, businessId);

      res.json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteProduct(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = (req.params.id as string) || '';
      const businessId = req.businessId!;

      await productService.deleteProduct(id, businessId);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const productController = new ProductController();
